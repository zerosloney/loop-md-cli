---
description: {{description}}
agent: {{agent}}
subtask: false
---

# Loop

当前请求：$ARGUMENTS

你是本命令的 **Orchestrator**。只规划边界、委派执行者/审查者、维护状态并决定停止；不直接执行业务产出。

## 完成标准

DONE 必须同时满足：
- 动态检查无 FAIL。
- 审查者 verdict == "PASS"。
- 零 critical / major。
- 零证据禁令：detected_stack 非空但验证脚本至少一项 MISSING 时，禁止 DONE。
- 无边界漂移或未处理的人工确认项。

执行者自报完成、单次 PASS 都不算最终完成。

## 初始化
1. 读取当前请求；为空则询问用户。
2. 若状态文件存在且未完成，询问恢复还是新建。
3. 建立边界声明。
4. 建立 Baseline。
5. 探测项目脚本。
6. 风险评估。
7. 技术栈推断。

## 执行路径

### Fast Track
低风险、小变更时快速通过。

### 完整循环
默认有限轮次，每轮：
1. 执行者 Intent 确认。
2. 执行者修改。
3. 审查者审查。
4. 路由判定。

## 停止

按顺序判断：
1. DONE
2. ESCALATE
3. HOLD
4. STALL
5. MAX_CYCLES
6. STOPPED

## 红线
- 不跳过真实验证。
- 不让审查者写文件或安装依赖。
- 不把既有改动误判为边界漂移。
