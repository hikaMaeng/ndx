# MCP resource read failures stay inside the ndx turn instead of crashing the CLI

- suite: mcp-resource-cli-error-0.1.41
- runned: 2026-05-08T17:00:44.339Z
- dependencies: ndx 0.1.41, previous 0.1.40

## Results

### reproduction

- PASS mcp-resource-error-repro: Missing MCP resource currently reproduces a request-level failure
  - PASS call-resource-tool: The current tool execution path rejects the whole call when a resource read throws.
    - evidence: Focused Node reproduction against packages/ndx/dist/agent/loop/tool-execution.js exited 0 after catching the thrown error.
    - evidence: Observed error text: MCP server local has no readable resource file:///C:/Users/hika0/.ndx/skills/web-service-scaffold/references/checklist.md.

### implementation

- PASS tool-error-containment: Agent loop converts tool exceptions into model-visible tool results
  - PASS inspect-tool-execution: executeToolCall now wraps registry.execute through executeRegistryTool and returns JSON error output for non-abort exceptions.
    - evidence: packages/ndx/src/agent/loop/tool-execution.ts catches registry.execute errors, calls throwIfAborted(options.signal), and returns { error: { tool, message } } JSON.
  - PASS run-focused-regression: The focused regression returns a function_call_output item and a tool_result event instead of throwing.
    - evidence: Node regression against packages/ndx/dist/agent/loop/tool-execution.js exited 0.
    - evidence: Regression output contained call_id call-regression and JSON error.tool read_mcp_resource.
    - evidence: Regression tool_result event output contained the MCP server local missing-resource message.

### documentation

- PASS tool-error-docs: Docs record the tool failure containment contract
  - PASS update-testing-doc: Root and package testing docs record the missing-MCP-resource regression suite.
    - evidence: docs/testing.md mentions test/20260509/013818_mcp-resource-cli-error.json.
    - evidence: packages/ndx/docs/testing.md mentions test/20260509/013818_mcp-resource-cli-error.json and the function_call_output containment contract.

### release

- PASS build-deploy-publish: Build, deploy, publish, and install the fixed version
  - PASS build-deploy: Build and deploy verification completed successfully.
    - evidence: yarn install --immutable exited 0.
    - evidence: yarn build exited 0 across all four packages.
    - evidence: npm run deploy exited 0.
    - evidence: Deploy built hika00/ndx-sandbox:0.1.1 and started/stopped/removed compose container ndx-deploy-56648-ndx-sandbox-1.
  - PASS publish-install: The fixed version was published and installed from Verdaccio.
    - evidence: npm publish for @neurondev/ndx-core@0.1.41 exited 0.
    - evidence: npm publish for @neurondev/ndx@0.1.41 exited 0.
    - evidence: npm view @neurondev/ndx-core@0.1.41 returned 0.1.41.
    - evidence: npm view @neurondev/ndx@0.1.41 returned 0.1.41.
    - evidence: Clean prefix install from Verdaccio added 2 packages.
    - evidence: /tmp/ndx-publish-check-0.1.41/prefix/bin/ndx --version returned 0.1.41.
    - evidence: /tmp/ndx-publish-check-0.1.41/prefix/bin/ndxserver --version returned 0.1.41.
    - evidence: Installed package regression returned a JSON tool error output for read_mcp_resource instead of throwing.

