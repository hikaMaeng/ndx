# Usage

## Spawn A Process

```rust
use codex_process::{ProcessId, ProcessManager, ProcessSpec};

# async fn example() -> Result<(), Box<dyn std::error::Error>> {
let manager = ProcessManager::new();
let handle = manager
    .spawn(
        ProcessId::from("build"),
        ProcessSpec::new(vec!["sh".into(), "-c".into(), "printf ok".into()]),
    )
    .await?;

let output = handle.wait().await?;
assert!(output.exit.success);
# Ok(())
# }
```

## Run A Plan

```rust
use codex_process::{TaskId, TaskPlan, TaskQueue};

# async fn example(queue: TaskQueue) -> Result<(), Box<dyn std::error::Error>> {
let plan = TaskPlan::Serial(vec![
    TaskPlan::Parallel(vec![
        TaskPlan::Task(TaskId::from("lint")),
        TaskPlan::Task(TaskId::from("test")),
    ]),
    TaskPlan::Task(TaskId::from("package")),
]);

let _results = queue.run(plan).await?;
# Ok(())
# }
```
