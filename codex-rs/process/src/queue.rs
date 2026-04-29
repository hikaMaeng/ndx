use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::Mutex;
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;

use crate::TaskId;
use crate::TaskPlan;
use crate::TaskStatus;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CancelReason {
    Queue,
    Task(TaskId),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueueEvent {
    StatusChanged { task_id: TaskId, status: TaskStatus },
    CancelRequested { reason: CancelReason },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskResult {
    pub task_id: TaskId,
    pub status: TaskStatus,
    pub message: Option<String>,
}

impl TaskResult {
    pub fn succeeded(task_id: TaskId) -> Self {
        Self {
            task_id,
            status: TaskStatus::Succeeded,
            message: None,
        }
    }

    pub fn failed(task_id: TaskId, message: impl Into<String>) -> Self {
        Self {
            task_id,
            status: TaskStatus::Failed,
            message: Some(message.into()),
        }
    }

    pub fn cancelled(task_id: TaskId) -> Self {
        Self {
            task_id,
            status: TaskStatus::Cancelled,
            message: None,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum QueueError {
    #[error("unknown task {0}")]
    UnknownTask(TaskId),
    #[error("task {0} failed: {1}")]
    TaskFailed(TaskId, String),
    #[error("task {0} cancelled")]
    Cancelled(TaskId),
}

#[derive(Clone)]
pub struct TaskContext {
    task_id: TaskId,
    cancel: CancellationToken,
}

impl TaskContext {
    pub fn task_id(&self) -> &TaskId {
        &self.task_id
    }

    pub fn cancellation_token(&self) -> &CancellationToken {
        &self.cancel
    }
}

#[async_trait]
pub trait QueueTask: Send + Sync {
    fn id(&self) -> &TaskId;

    async fn run(&self, context: TaskContext) -> TaskResult;

    async fn on_cancel(&self, _reason: CancelReason) {}
}

#[derive(Clone, Default)]
pub struct TaskQueue {
    inner: Arc<Inner>,
}

struct Inner {
    tasks: Mutex<BTreeMap<TaskId, Arc<dyn QueueTask>>>,
    statuses: Mutex<BTreeMap<TaskId, TaskStatus>>,
    cancel: CancellationToken,
    events: broadcast::Sender<QueueEvent>,
}

impl Default for Inner {
    fn default() -> Self {
        let (events, _events_rx) = broadcast::channel(256);
        Self {
            tasks: Mutex::new(BTreeMap::new()),
            statuses: Mutex::new(BTreeMap::new()),
            cancel: CancellationToken::new(),
            events,
        }
    }
}

impl TaskQueue {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn register<T>(&self, task: T)
    where
        T: QueueTask + 'static,
    {
        let task_id = task.id().clone();
        self.inner
            .tasks
            .lock()
            .await
            .insert(task_id.clone(), Arc::new(task));
        self.set_status(task_id, TaskStatus::Pending).await;
    }

    pub fn subscribe(&self) -> broadcast::Receiver<QueueEvent> {
        self.inner.events.subscribe()
    }

    pub async fn status(&self, task_id: &TaskId) -> Option<TaskStatus> {
        self.inner.statuses.lock().await.get(task_id).copied()
    }

    pub async fn run(&self, plan: TaskPlan) -> Result<Vec<TaskResult>, QueueError> {
        self.run_plan(plan).await
    }

    pub async fn cancel_all(&self) {
        self.inner.cancel.cancel();
        let _ = self.inner.events.send(QueueEvent::CancelRequested {
            reason: CancelReason::Queue,
        });
        let tasks = self
            .inner
            .tasks
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for task in tasks {
            task.on_cancel(CancelReason::Queue).await;
        }
    }

    pub async fn cancel_task(&self, task_id: &TaskId) -> Result<(), QueueError> {
        let task = self
            .inner
            .tasks
            .lock()
            .await
            .get(task_id)
            .cloned()
            .ok_or_else(|| QueueError::UnknownTask(task_id.clone()))?;
        let reason = CancelReason::Task(task_id.clone());
        let _ = self.inner.events.send(QueueEvent::CancelRequested {
            reason: reason.clone(),
        });
        task.on_cancel(reason).await;
        self.set_status(task_id.clone(), TaskStatus::Cancelled)
            .await;
        Ok(())
    }

    fn run_plan(
        &self,
        plan: TaskPlan,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<TaskResult>, QueueError>> + Send + '_>> {
        Box::pin(async move {
            match plan {
                TaskPlan::Task(task_id) => self.run_task(task_id).await.map(|result| vec![result]),
                TaskPlan::Serial(plans) => {
                    let mut results = Vec::new();
                    for plan in plans {
                        results.extend(self.run_plan(plan).await?);
                    }
                    Ok(results)
                }
                TaskPlan::Parallel(plans) => {
                    let mut handles = Vec::new();
                    for plan in plans {
                        let queue = self.clone();
                        handles.push(tokio::spawn(async move { queue.run_plan(plan).await }));
                    }
                    let mut results = Vec::new();
                    for handle in handles {
                        match handle.await {
                            Ok(Ok(mut task_results)) => results.append(&mut task_results),
                            Ok(Err(err)) => return Err(err),
                            Err(err) => {
                                return Err(QueueError::TaskFailed(
                                    TaskId::new("parallel"),
                                    err.to_string(),
                                ));
                            }
                        }
                    }
                    Ok(results)
                }
            }
        })
    }

    async fn run_task(&self, task_id: TaskId) -> Result<TaskResult, QueueError> {
        if self.inner.cancel.is_cancelled() {
            self.set_status(task_id.clone(), TaskStatus::Cancelled)
                .await;
            return Err(QueueError::Cancelled(task_id));
        }

        let task = self
            .inner
            .tasks
            .lock()
            .await
            .get(&task_id)
            .cloned()
            .ok_or_else(|| QueueError::UnknownTask(task_id.clone()))?;
        self.set_status(task_id.clone(), TaskStatus::Running).await;
        let result = task
            .run(TaskContext {
                task_id: task_id.clone(),
                cancel: self.inner.cancel.child_token(),
            })
            .await;
        self.set_status(result.task_id.clone(), result.status).await;

        match result.status {
            TaskStatus::Succeeded => Ok(result),
            TaskStatus::Cancelled => Err(QueueError::Cancelled(result.task_id)),
            TaskStatus::Failed => Err(QueueError::TaskFailed(
                result.task_id,
                result.message.unwrap_or_else(|| "task failed".to_string()),
            )),
            TaskStatus::Pending | TaskStatus::Running => Ok(result),
        }
    }

    async fn set_status(&self, task_id: TaskId, status: TaskStatus) {
        self.inner
            .statuses
            .lock()
            .await
            .insert(task_id.clone(), status);
        let _ = self
            .inner
            .events
            .send(QueueEvent::StatusChanged { task_id, status });
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use pretty_assertions::assert_eq;
    use tokio::sync::Mutex as TokioMutex;

    use super::*;

    struct RecordingTask {
        id: TaskId,
        record: Arc<TokioMutex<Vec<String>>>,
    }

    #[async_trait]
    impl QueueTask for RecordingTask {
        fn id(&self) -> &TaskId {
            &self.id
        }

        async fn run(&self, context: TaskContext) -> TaskResult {
            self.record
                .lock()
                .await
                .push(context.task_id().as_str().to_string());
            TaskResult::succeeded(context.task_id().clone())
        }
    }

    #[tokio::test]
    async fn serial_plan_runs_tasks_in_order() {
        let queue = TaskQueue::new();
        let record = Arc::new(TokioMutex::new(Vec::new()));
        queue
            .register(RecordingTask {
                id: TaskId::from("a"),
                record: Arc::clone(&record),
            })
            .await;
        queue
            .register(RecordingTask {
                id: TaskId::from("b"),
                record: Arc::clone(&record),
            })
            .await;

        let results = queue
            .run(TaskPlan::Serial(vec![
                TaskPlan::Task(TaskId::from("a")),
                TaskPlan::Task(TaskId::from("b")),
            ]))
            .await
            .expect("run plan");

        assert_eq!(
            results,
            vec![
                TaskResult::succeeded(TaskId::from("a")),
                TaskResult::succeeded(TaskId::from("b")),
            ]
        );
        assert_eq!(*record.lock().await, vec!["a".to_string(), "b".to_string()]);
    }

    #[tokio::test]
    async fn cancel_task_invokes_hook() {
        struct HookTask {
            id: TaskId,
            seen: Arc<TokioMutex<Vec<CancelReason>>>,
        }

        #[async_trait]
        impl QueueTask for HookTask {
            fn id(&self) -> &TaskId {
                &self.id
            }

            async fn run(&self, context: TaskContext) -> TaskResult {
                TaskResult::succeeded(context.task_id().clone())
            }

            async fn on_cancel(&self, reason: CancelReason) {
                self.seen.lock().await.push(reason);
            }
        }

        let queue = TaskQueue::new();
        let seen = Arc::new(TokioMutex::new(Vec::new()));
        queue
            .register(HookTask {
                id: TaskId::from("hook"),
                seen: Arc::clone(&seen),
            })
            .await;

        queue
            .cancel_task(&TaskId::from("hook"))
            .await
            .expect("cancel task");

        assert_eq!(
            *seen.lock().await,
            vec![CancelReason::Task(TaskId::from("hook"))]
        );
    }
}
