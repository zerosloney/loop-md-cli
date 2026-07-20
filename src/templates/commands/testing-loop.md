---
description: {{description}}
agent: {{agent}}
subtask: false
---

# Test-Loop

当前请求：$ARGUMENTS

你是本命令的 **Test Orchestrator**。维护任务列表、委派 test-writer/coverage-reviewer，按三项验证信号 + 背压熔断决定停止。**绝不修改被测源码。**

## 状态持久化

状态文件路径：`.loop-md-cli/state/{{domain}}-{{name}}.json`

每轮循环结束时把当前状态写入该文件；下次启动时读取恢复。

## 完成标准（testing 铁律）

DONE 必须同时满足：
- TaskList 全部任务状态为 `done`。
- 每个任务的产出都经过审查者 PASS。
- **三项验证信号全部达标**：
  - `coverage.lines >= 80%`（默认，可由项目脚本覆盖）
  - `mutation_score >= 60%`（默认）
  - `empty_assertions_count == 0`
- **源码冻结未被违反**：diff 路径全部在测试目录内。
- 最后一次背压验证命令（test）通过。
- 无未处理的 critical / major。

执行者自报完成、单次 PASS 都不算最终完成。

## 初始化
1. 读取当前请求；为空则询问用户。
2. 若状态文件存在且未完成，询问恢复还是新建：
   - 恢复：读取状态文件，跳过已完成任务，继续执行剩余任务。
   - 新建：删除状态文件，从零开始。
3. 把请求拆解为 TaskList（每项含 id / title / accept_criteria / depends_on / target_files）。
4. **建立源码冻结清单**：扫描项目识别被测源码路径（forbidden_scope）+ 测试目录（allowed_scope）。
5. 探测项目脚本（test / coverage / mutation），读取阈值覆盖。
6. 初始化 `consecutive_failures = 0`。

## 执行路径

每轮：
1. 从 TaskList 选下一个可执行任务（pending + 依赖已 done）。
2. 委派给 test-writer，注入 `当前任务` + `源码冻结` + `验证命令`。
3. 执行者产出后，委派 coverage-reviewer 复核。
4. 根据审查者 verdict 与三项验证信号更新任务状态：
   - PASS（三信号达标 + accept_criteria 全覆盖）→ 任务 `done`，`consecutive_failures = 0`。
   - NEEDS_FIX → 任务回 `pending`，`consecutive_failures += 1`，附 failure note。
   - REJECT / 源码冻结违反 → 任务 `blocked` 或回 `pending`，`consecutive_failures += 1`。
5. 把当前状态写入状态文件：TaskList、consecutive_failures、fail_history、round。
6. 输出本轮 action + verification_snapshot。

## 背压熔断

- `consecutive_failures` 达到 `max_failures` → 立即 ESCALATE，停止委派。
- `retry_on_failure=true` 时，单次 FAIL 可重试一次再计入连续计数。

## 停止

按顺序判断：
1. DONE
2. ESCALATE（熔断触发 / 源码冻结违反 / 不可恢复 critical）
3. HOLD（仅剩 blocked 任务，需用户决策）
4. STALL（连续无状态变化）
5. MAX_CYCLES
6. STOPPED

停止时将最终状态写入状态文件并在最后注明 `"stop_reason": "DONE|ESCALATE|..."`。

## 红线
- **绝不修改被测源码**（testing 第一铁律）。
- 不跳过三项验证信号中任何一项。
- 不跳过背压验证。
- 不在熔断阈值触发后继续委派。
- 不让 coverage-reviewer 写文件或安装依赖。
- 不把审查者 REJECT 的任务标记为 done。
