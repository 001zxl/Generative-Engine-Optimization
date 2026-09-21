/**
 * 登录节流（纯函数 + 可注入存储，便于单测）。
 *
 * ── 这里修掉过一个真实缺陷 ──
 *
 * 旧实现把失败计数键设为表单里的隐藏字段 `hint`。而 `hint` 由客户端提交 ——
 * 攻击者每次请求改一个值，就能每次都拿到全新的计数器，**节流形同虚设**。
 *
 * 现在改为两层：
 *
 *   1. **按客户端 IP**：单 IP 连续失败 8 次锁 10 分钟
 *   2. **全局**：所有来源合计失败 30 次锁 10 分钟
 *
 * 为什么必须有全局层：`x-forwarded-for` 只在**可信代理**后面才可信，
 * 直连部署时它可以被伪造 —— 伪造就能绕过按 IP 的那一层。
 * 本系统只有一个口令（单操作员），所以针对口令的分布式猜测必须由全局层兜住。
 *
 * 已知限制：内存计数只适用于单实例。多实例需换 Redis（与前期限流一致）。
 */

export interface ThrottleConfig {
  maxPerIp: number;
  maxGlobal: number;
  windowMs: number;
}

export const DEFAULT_THROTTLE: ThrottleConfig = {
  maxPerIp: 8,
  maxGlobal: 30,
  windowMs: 10 * 60 * 1000,
};

/** perIp 表容量上限，超出时清理过期项 —— 防伪造来源造成内存增长 */
const MAX_TRACKED_IPS = 5000;

export interface ThrottleState {
  perIp: Map<string, number[]>;
  global: number[];
}

export function createThrottleState(): ThrottleState {
  return { perIp: new Map(), global: [] };
}

export interface ThrottleVerdict {
  allowed: boolean;
  reason?: "ip" | "global";
  retryAfterSec: number;
}

function prune(list: number[], now: number, windowMs: number): number[] {
  const cutoff = now - windowMs;
  return list.filter((t) => t > cutoff);
}

/** 判断本次尝试是否放行（不改状态） */
export function evaluateAttempt(
  state: ThrottleState,
  ipKey: string,
  now: number,
  cfg: ThrottleConfig = DEFAULT_THROTTLE,
): ThrottleVerdict {
  // ⚠️ 只读判断，**不写入空数组**。
  // 早期版本在这里无条件 set(ipKey, []) —— 攻击者伪造 X-Forwarded-For 不断变换 IP
  // 就能让 perIp 这个 Map 无界增长，构成内存耗尽。写入只发生在真的失败时（noteFailure）。
  const ipHits = prune(state.perIp.get(ipKey) ?? [], now, cfg.windowMs);
  if (ipHits.length > 0) state.perIp.set(ipKey, ipHits);
  else state.perIp.delete(ipKey);
  const globalHits = prune(state.global, now, cfg.windowMs);
  state.global = globalHits;

  if (ipHits.length >= cfg.maxPerIp) {
    return {
      allowed: false,
      reason: "ip",
      retryAfterSec: Math.max(1, Math.ceil((ipHits[0] + cfg.windowMs - now) / 1000)),
    };
  }
  if (globalHits.length >= cfg.maxGlobal) {
    return {
      allowed: false,
      reason: "global",
      retryAfterSec: Math.max(1, Math.ceil((globalHits[0] + cfg.windowMs - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/** 记录一次失败 */
export function noteFailure(
  state: ThrottleState,
  ipKey: string,
  now: number,
  cfg: ThrottleConfig = DEFAULT_THROTTLE,
): void {
  const ipHits = prune(state.perIp.get(ipKey) ?? [], now, cfg.windowMs);
  ipHits.push(now);
  state.perIp.set(ipKey, ipHits);
  state.global = [...prune(state.global, now, cfg.windowMs), now];

  // Map 容量上限：防止伪造来源导致的键无限增长
  if (state.perIp.size > MAX_TRACKED_IPS) {
    for (const [k, v] of state.perIp) {
      const alive = prune(v, now, cfg.windowMs);
      if (alive.length === 0) state.perIp.delete(k);
      if (state.perIp.size <= MAX_TRACKED_IPS / 2) break;
    }
  }
}

/** 成功登录后清掉该 IP 的计数（全局计数保留，避免用成功登录洗掉全局画像） */
export function noteSuccess(state: ThrottleState, ipKey: string): void {
  state.perIp.delete(ipKey);
}

/* —— 默认单例（进程内） —— */
const singleton = createThrottleState();

export function defaultThrottle(): ThrottleState {
  return singleton;
}
