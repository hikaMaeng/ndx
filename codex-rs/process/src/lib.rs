//! Shared process execution and hierarchical task-queue primitives.

mod manager;
mod queue;
mod types;

pub use manager::ProcessError;
pub use manager::ProcessHandle;
pub use manager::ProcessManager;
pub use manager::ProcessOutput;
pub use queue::CancelReason;
pub use queue::QueueError;
pub use queue::QueueEvent;
pub use queue::QueueTask;
pub use queue::TaskContext;
pub use queue::TaskQueue;
pub use queue::TaskResult;
pub use types::ProcessEvent;
pub use types::ProcessExit;
pub use types::ProcessId;
pub use types::ProcessSpec;
pub use types::TaskId;
pub use types::TaskPlan;
pub use types::TaskStatus;
