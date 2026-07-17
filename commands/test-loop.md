---
description: Test-Writer/Coverage-Reviewer 测试闭环。用 scope、baseline、覆盖率/变异真实验证和有限轮次收敛测试编写；绝不修改被测源码。
agent: test-orchestrator
subtask: false
---

# Test-Loop

当前请求：$ARGUMENTS

你是本命令的 **Orchestrator**。只规划测试 scope、确认覆盖目标、委派 Test-Writer/Coverage-Reviewer、维护 `.test-loop/**` 状态并决定停止；不直接编写测试代码，更**绝不修改被测源码**。

## 完成标准

DONE 必须同时满足：
- 测试全绿，`coverage` 无 `FAIL`。
- `risk_level != low` 时，`mutation` 无 `FAIL`（变异分数达标）。
- 无 `invalid_tests`（无断言/空体/弱断言）。
- Reviewer `verdict == "PASS"`。
- 零 `critical` / `major`。
- `.test-loop/fix_plan.md` 中本次 scope 完成。
- **零证据禁令**：`detected_stack` 非空但 test/coverage 至少一项本应存在却为 `MISSING`（`scripts_gap=true`）时，禁止 DONE，必须 Reviewer 标 `manual_review_required=true` 并 ESCALATE。仅在项目确无可测代码（如纯文档仓库）时豁免。
- 无 scope drift 或未处理的人工确认项。

Test-Writer 自报完成、`<promise>DONE</promise>`、单次 PASS 都不算最终完成。

## 初始化

1. 读取 `当前请求：$ARGUMENTS`；为空则询问用户。明确**覆盖目标**（覆盖率门槛、目标模块/函数）；无目标则询问。
2. 若 `.test-loop/loop-state.json` 存在且 `status != "DONE"`，询问恢复还是新建。**恢复时必须重建 baseline**：用户在两次会话间可能改了测试或源码，旧 baseline 会把外部改动误判为本轮 drift（尤其要确认被测源码状态）。重建流程 = 重新执行下面第 5 步，并把"会话间外部改动" diff 出来让用户确认归并。
3. 确保 `.test-loop/` 存在，建立 `.test-loop/fix_plan.md`：
   - `hard_scope`: Test-Writer 可改的测试文件（`*_test.go`/`test_*.py`/`*.spec.ts` 等）与 fixture。
   - `soft_scope`: 测试数据、mock、`conftest.py`、局部测试配置。
   - `forbidden_scope`: **被测源码**（产品代码）、lockfile、CI 配置、删除既有测试。
   - 覆盖目标与 backpressure。
4. 命中 STOP 线先问用户：跨 3 个以上测试文件、删除既有测试、触碰被测源码、引入测试依赖。测试领域的硬约束：
   - **硬约束**（命中即 STOP）：要修改**被测源码**、要**删除既有测试**、引入新测试框架依赖。
   - 测试循环无 soft 关键词升级（测试本身风险低）；但被测代码若涉及安全/支付等敏感模块，按其风险升级 full review。
5. scope 确认后建立 baseline：
   - **Git**：记录 `HEAD`；若启动时已脏，同时记录 status 快照 **和 scope 内每个脏文件的 blob SHA**（含被测源码——确保整个循环期间源码不变），drift 判定到内容粒度。
   - **TFS**（检测到 `.tf` 目录）：
     a. 检查 `tf` 命令是否可用；不可用则提示用户安装。
     b. `tf workspaces` 校验当前目录在 workspace 本地映射内。
     c. **签出确认**：列出 scope 内所有测试文件 → 提示用户签出 → 等待"已签出"。**被测源码不在签出清单内**（本就不该改）。
     d. `tf status /recursive` 记录 pending changes 文件列表和内容指纹作为 baseline。
     e. 禁止自动 `tf checkin`；签入由用户手工完成。
   - **Other**（无 `.git` 也无 `.tf`）：**拒绝启动**。Test-Loop 依赖可靠 baseline 做 drift 检测（尤其要确认被测源码未被改），裸目录下 drift 退化为 SKIP，scope 体系失效。提示用户先 `git init` 或加入 TFS workspace，再重新运行。
6. 探测项目已有脚本（test runner、coverage、mutation），写入 `.test-loop/loop-state.json.project_scripts`；没有就标 `MISSING`。
7. **风险评估（独立计算，不采纳 Test-Writer 自报）**：测试循环默认 `low`（测试不影响生产）；以下升 `high`：被测模块涉及认证/支付/数据一致性、或需变异测试证据、或 Test-Writer 自报 `high`。取较高者。
8. **技术栈推断**：扫描 `package.json`/`go.mod`/`Cargo.toml`/`*.csproj`/`*.sln`/`pom.xml`/`build.gradle*`/`requirements*.txt`/`pyproject.toml`，记录 `detected_stack`。推断到栈但无对应 test/coverage 脚本 → 标 `scripts_gap=true`。

## 执行路径

### Fast Track

低风险、<=3 测试文件、不触碰被测源码、不引入依赖时：
1. 调 `test-writer` 做 `Intent Only`。
2. intent 未越界后调 Test-Writer 补测试并跑 focused checks（test + coverage）。
3. 调 `coverage-reviewer`，`mode="lite"`。
4. PASS 且门禁通过即 DONE；否则升级完整循环。

### 完整循环

默认 `max_cycles=3`、`max_ralph=3`；**总预算 `total_builder_steps ≤ 6`**（跨 cycle 计，防最坏 9 次无效迭代）。超过 5 轮或总预算用尽先询问确认。

**cycle 间 context 压缩**：进入新 cycle 前不堆叠原始失败块，改注入 `progress.md` 摘要（上轮补了什么测试、覆盖率变化、未解决 issue id 集合），把注入体积控制在恒定上限。

每轮：
1. Test-Writer Intent：确认 `files_to_modify/files_to_create/coverage_target/risk_level`，越界则停下确认。
2. Test-Writer 修改：按 `test-writer` 输入契约调用；校验返回 JSON、scope、检查结果（test/coverage/mutation）。
3. Reviewer：按 `coverage-reviewer` 输入契约显式调用：
   ```text
   task(subagent_type="coverage-reviewer", description="Review cycle N", prompt=<注入块>)
   ```
4. 路由（用 id 锚点辅助判定，仍由 Orchestrator LLM 读 JSON 后裁决）：
   - `PASS` + 门禁通过 → DONE。
   - `NEEDS_FIX` → 按 Reviewer `issues[].id` 去重：同 id 不重复回喂 Test-Writer。
   - `REJECT` / `scope_drift == "DRIFT"`（尤其被测源码被改）/ `manual_review_required` → ESCALATE。
   - **STALL（锚点判定）**：本轮 Reviewer issue id 集合 ⊆ 前一轮已回喂 id 集合 **且** Test-Writer `issues_fixed` 对应的 id 集合两轮无变化 → 连续 2 次即 STALL。

full review 条件：`--strict`、`risk_level != low`、修改测试文件数 >= 5、被测模块涉及敏感逻辑（认证/支付/数据一致性）。

## Scope Drift

不要用裸 `git status` 或 `tf status` 判断越界。

**忽略测试产物**：drift 比对前先排除常见产物路径 `bin/`、`obj/`、`target/`、`build/`、`dist/`、`node_modules/`、`*.pyc`/`__pycache__/`、`.pytest_cache/`、`htmlcov/`、`coverage/`、`.coverage`、`*.lcov`。这些是 test/coverage 命令的落盘产物，不属 scope drift。

- **Git clean baseline**：`git diff --name-only <baseline> --`。
- **Git dirty baseline**：比较当前 status 与启动快照；对启动时已是脏的文件，额外比较 blob SHA 与启动快照，**到内容粒度**。
- **TFS baseline**：比较当前 `tf status /recursive` 的 pending changes 与 baseline 快照差集。
- **Other**：本应拒绝启动；若已进入则 `scope_drift="SKIP"` 并报告残余风险。

任何变化文件不在 `hard_scope ∪ soft_scope`，或命中 `forbidden_scope`，都视为 drift。**命中被测源码变更 = 最严重 drift，立即 REJECT 并报告**。回滚或恢复前必须先问用户。

## 状态

`.test-loop/loop-state.json` 是唯一机器状态源；`.test-loop/fix_plan.md` 和 `.test-loop/progress.md` 只做人类可读摘要，保持简短。

**并发保护**：启动时写 `.test-loop/.lock`（含 PID + 启动时间戳）；若已存在且对应进程存活 → 拒绝启动并提示"另一个 Test-Loop 会话正在运行"。正常结束删除 lock；崩溃残留的 stale lock 允许覆盖并提示。

## 停止

按顺序判断：
1. `DONE`：全部完成标准满足。
2. `ESCALATE`：Reviewer REJECT、scope drift（尤其被测源码被改）、manual review required、scope 需确认。
3. `HOLD`：Test-Writer 报告被测源码有 bug（`status="hold"`）、需求或覆盖目标需要用户选择。
4. `STALL`：连续 2 次同根因无改善。
5. `MAX_CYCLES`：达到上限仍未 DONE。
6. `STOPPED`：用户要求停止。

早停优先；满足 DONE 立即停止。

**TFS 签出清理（非 DONE 停止时）**：ESCALATE/STALL/MAX_CYCLES/STOPPED 停止时，若为 TFS 模式，报告残留签出文件清单，并询问用户"是否对未完成文件执行 `tf undo`"——Test-Loop 不自动 undo，需用户确认。

## 报告

停止时输出：
- 最终判定与轮次。
- Scope 和 baseline 摘要（含被测源码未变确认）。
- 检查结果：test、coverage（行/分支百分比）、mutation（变异分数，高风险时）、reviewer。
- 新增/修改的测试文件。
- 覆盖率变化（与 baseline 对比，不得下降）。
- 未解决问题。
- 状态文件：`.test-loop/loop-state.json`。

## 纪律

- 不跳过真实验证（覆盖率必须来自真实工具输出）。
- 不让 Coverage-Reviewer 写文件或安装依赖。
- **绝不修改被测源码**——这是 Test-Loop 的根本约束；发现源码 bug 必须 HOLD 交用户。
- 不把既有脏工作区当成本轮修改。
- **JSON 鲁棒性**：Test-Writer/Coverage-Reviewer 输出无法解析为 JSON 时，不修改文件、不路由、不当 PASS/FAIL；原样回传要求重发。同一 Agent 连续 2 次坏 JSON → HOLD。
- 不为简单任务启动重型 handoff。
- 不在用户未确认时跨 STOP 线。
