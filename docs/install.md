## Installing And Building

### System requirements

| Requirement                 | Details                                                         |
| --------------------------- | --------------------------------------------------------------- |
| Operating systems           | macOS 12+, Ubuntu 20.04+/Debian 10+, or Windows 11 **via WSL2** |
| Git (optional, recommended) | 2.23+ for repository workflows                                  |
| RAM                         | 4-GB minimum (8-GB recommended)                                 |

### Build from source

```bash
git clone https://github.com/hikaMaeng/ndx.git
cd ndx
yarn install --immutable
npm run build
npm test
```

### Run

```bash
npm install -g @neurondev/ndx
ndx
```

Source-tree development can bypass workspace Docker:

```bash
node dist/src/cli/main.js --mock "create tmp/example.txt"
```

### Deploy Verification

```bash
npm run deploy
```
