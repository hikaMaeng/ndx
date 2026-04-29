use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::process::Stdio;
use std::sync::Arc;

use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::sync::broadcast;
use tokio::sync::oneshot;

use crate::ProcessEvent;
use crate::ProcessExit;
use crate::ProcessId;
use crate::ProcessSpec;

#[derive(Debug, thiserror::Error)]
pub enum ProcessError {
    #[error("argv must not be empty")]
    EmptyArgv,
    #[error("process {0} already exists")]
    DuplicateProcess(ProcessId),
    #[error("unknown process {0}")]
    UnknownProcess(ProcessId),
    #[error("failed to spawn process: {0}")]
    Spawn(#[source] std::io::Error),
    #[error("failed to wait for process: {0}")]
    Wait(#[source] std::io::Error),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessOutput {
    pub process_id: ProcessId,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub exit: ProcessExit,
}

#[derive(Clone, Default)]
pub struct ProcessManager {
    inner: Arc<Mutex<HashMap<ProcessId, RunningProcess>>>,
}

struct RunningProcess {
    cancel: Option<oneshot::Sender<()>>,
}

pub struct ProcessHandle {
    process_id: ProcessId,
    events: broadcast::Sender<ProcessEvent>,
    done: oneshot::Receiver<Result<ProcessOutput, ProcessError>>,
}

impl ProcessManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn spawn(
        &self,
        process_id: ProcessId,
        spec: ProcessSpec,
    ) -> Result<ProcessHandle, ProcessError> {
        let (program, args) = spec.argv.split_first().ok_or(ProcessError::EmptyArgv)?;
        {
            let mut processes = self.inner.lock().await;
            match processes.entry(process_id.clone()) {
                Entry::Occupied(_) => return Err(ProcessError::DuplicateProcess(process_id)),
                Entry::Vacant(entry) => {
                    entry.insert(RunningProcess { cancel: None });
                }
            }
        }

        let mut command = Command::new(program);
        command.args(args);
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        if spec.pipe_stdin {
            command.stdin(Stdio::piped());
        } else {
            command.stdin(Stdio::null());
        }
        if let Some(cwd) = &spec.cwd {
            command.current_dir(cwd);
        }
        if spec.clear_env {
            command.env_clear();
        }
        command.envs(&spec.env);

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(err) => {
                self.inner.lock().await.remove(&process_id);
                return Err(ProcessError::Spawn(err));
            }
        };
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let (events, _events_rx) = broadcast::channel(256);
        let (cancel_tx, cancel_rx) = oneshot::channel();
        let (done_tx, done_rx) = oneshot::channel();

        {
            let mut processes = self.inner.lock().await;
            if let Some(process) = processes.get_mut(&process_id) {
                process.cancel = Some(cancel_tx);
            }
        }

        let _ = events.send(ProcessEvent::Started {
            process_id: process_id.clone(),
        });
        tokio::spawn(run_child(RunChild {
            process_id: process_id.clone(),
            child,
            stdout,
            stderr,
            cancel_rx,
            events: events.clone(),
            done: done_tx,
            processes: Arc::clone(&self.inner),
        }));

        Ok(ProcessHandle {
            process_id,
            events,
            done: done_rx,
        })
    }

    pub async fn cancel(&self, process_id: &ProcessId) -> Result<(), ProcessError> {
        let cancel = {
            let mut processes = self.inner.lock().await;
            let running = processes
                .get_mut(process_id)
                .ok_or_else(|| ProcessError::UnknownProcess(process_id.clone()))?;
            running.cancel.take()
        };
        if let Some(cancel) = cancel {
            let _ = cancel.send(());
        }
        Ok(())
    }

    pub async fn cancel_all(&self) {
        let cancels = {
            let mut processes = self.inner.lock().await;
            processes
                .values_mut()
                .filter_map(|process| process.cancel.take())
                .collect::<Vec<_>>()
        };
        for cancel in cancels {
            let _ = cancel.send(());
        }
    }
}

impl ProcessHandle {
    pub fn process_id(&self) -> &ProcessId {
        &self.process_id
    }

    pub fn subscribe(&self) -> broadcast::Receiver<ProcessEvent> {
        self.events.subscribe()
    }

    pub async fn wait(self) -> Result<ProcessOutput, ProcessError> {
        self.done
            .await
            .unwrap_or(Err(ProcessError::UnknownProcess(self.process_id)))
    }
}

struct RunChild {
    process_id: ProcessId,
    child: tokio::process::Child,
    stdout: Option<tokio::process::ChildStdout>,
    stderr: Option<tokio::process::ChildStderr>,
    cancel_rx: oneshot::Receiver<()>,
    events: broadcast::Sender<ProcessEvent>,
    done: oneshot::Sender<Result<ProcessOutput, ProcessError>>,
    processes: Arc<Mutex<HashMap<ProcessId, RunningProcess>>>,
}

async fn run_child(run: RunChild) {
    let RunChild {
        process_id,
        mut child,
        stdout,
        stderr,
        mut cancel_rx,
        events,
        done,
        processes,
    } = run;
    let stdout_task = tokio::spawn(read_stream(
        process_id.clone(),
        stdout,
        events.clone(),
        StreamKind::Stdout,
    ));
    let stderr_task = tokio::spawn(read_stream(
        process_id.clone(),
        stderr,
        events.clone(),
        StreamKind::Stderr,
    ));

    let wait_result = tokio::select! {
        wait = child.wait() => wait.map_err(ProcessError::Wait),
        _ = &mut cancel_rx => {
            let _ = child.start_kill();
            let _ = events.send(ProcessEvent::Cancelled {
                process_id: process_id.clone(),
            });
            child.wait().await.map_err(ProcessError::Wait)
        }
    };

    let stdout = stdout_task.await.unwrap_or_default();
    let stderr = stderr_task.await.unwrap_or_default();
    let result = wait_result.map(|status| {
        let exit = ProcessExit {
            code: status.code(),
            success: status.success(),
        };
        let _ = events.send(ProcessEvent::Exited {
            process_id: process_id.clone(),
            exit: exit.clone(),
        });
        ProcessOutput {
            process_id: process_id.clone(),
            stdout,
            stderr,
            exit,
        }
    });

    processes.lock().await.remove(&process_id);
    let _ = done.send(result);
}

#[derive(Clone, Copy)]
enum StreamKind {
    Stdout,
    Stderr,
}

async fn read_stream(
    process_id: ProcessId,
    stream: Option<impl tokio::io::AsyncRead + Unpin>,
    events: broadcast::Sender<ProcessEvent>,
    kind: StreamKind,
) -> Vec<u8> {
    let Some(mut stream) = stream else {
        return Vec::new();
    };
    let mut output = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        match stream.read(&mut buffer).await {
            Ok(0) => break,
            Ok(n) => {
                output.extend_from_slice(&buffer[..n]);
                let event = match kind {
                    StreamKind::Stdout => ProcessEvent::Stdout {
                        process_id: process_id.clone(),
                        chunk: buffer[..n].to_vec(),
                    },
                    StreamKind::Stderr => ProcessEvent::Stderr {
                        process_id: process_id.clone(),
                        chunk: buffer[..n].to_vec(),
                    },
                };
                let _ = events.send(event);
            }
            Err(_) => break,
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use tokio::time::Duration;
    use tokio::time::timeout;

    use super::*;

    #[tokio::test]
    async fn captures_process_output_and_exit() {
        let manager = ProcessManager::new();
        let handle = manager
            .spawn(
                ProcessId::from("echo"),
                ProcessSpec::new(vec![
                    "sh".to_string(),
                    "-c".to_string(),
                    "printf hello".to_string(),
                ]),
            )
            .await
            .expect("spawn process");

        let output = handle.wait().await.expect("wait process");

        assert_eq!(
            output,
            ProcessOutput {
                process_id: ProcessId::from("echo"),
                stdout: b"hello".to_vec(),
                stderr: Vec::new(),
                exit: ProcessExit {
                    code: Some(0),
                    success: true,
                },
            }
        );
    }

    #[tokio::test]
    async fn cancel_stops_running_process() {
        let manager = ProcessManager::new();
        let process_id = ProcessId::from("sleep");
        let handle = manager
            .spawn(
                process_id.clone(),
                ProcessSpec::new(vec![
                    "sh".to_string(),
                    "-c".to_string(),
                    "sleep 5".to_string(),
                ]),
            )
            .await
            .expect("spawn process");

        manager.cancel(&process_id).await.expect("cancel process");
        let output = timeout(Duration::from_secs(2), handle.wait())
            .await
            .expect("cancelled process should finish")
            .expect("wait process");

        assert_eq!(output.exit.success, false);
    }
}
