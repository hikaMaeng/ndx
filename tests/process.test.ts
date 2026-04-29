import test from "node:test";
import assert from "node:assert/strict";
import { runProcess, TaskQueue } from "../src/process/index.js";

test("runProcess captures output and exit status", async () => {
  const result = await runProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write('ok')"],
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "ok");
  assert.equal(result.stderr, "");
});

test("TaskQueue supports nested serial and parallel plans", async () => {
  const queue = new TaskQueue();
  const order: string[] = [];
  const results = await queue.run({
    serial: [
      {
        id: "first",
        run: async () => {
          order.push("first");
          return "first";
        },
      },
      {
        parallel: [
          {
            id: "parallel-a",
            run: async () => {
              order.push("parallel-a");
              return "parallel-a";
            },
          },
          {
            serial: [
              {
                id: "parallel-b1",
                run: async () => {
                  order.push("parallel-b1");
                  return "parallel-b1";
                },
              },
              {
                id: "parallel-b2",
                run: async () => {
                  order.push("parallel-b2");
                  return "parallel-b2";
                },
              },
            ],
          },
        ],
      },
    ],
  });

  assert.equal(order[0], "first");
  assert.deepEqual(
    results.map((result) => result.status),
    ["completed", "completed", "completed", "completed"],
  );
});
