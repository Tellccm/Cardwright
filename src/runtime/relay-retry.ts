import { isContextOverflow, isRetryableAssistantError, type AssistantMessage } from '@earendil-works/pi-ai';
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

/**
 * 中转站常见的报错说法也纳入自动重试 (ADR 0024).
 *
 * pi retries a failed request only when its error text matches pi-ai's own list (utils/retry.js), written in English
 * for the big providers. Relays word the same temporary failures their own way — often in Chinese, often mid-stream
 * with no status code — and those runs failed at the first hiccup. This hook runs where pi lets an extension replace
 * a finished message, before pi decides whether to retry: a failure pi would give up on, that reads as a relay's
 * temporary failure and as nothing worse, gets a short note that is also a phrase on pi's list.
 *
 * The list is short on purpose. A wording that could also mean "your key, balance or request is wrong" is not on it,
 * and a message that says so is never retried, whatever else it says.
 */
export const RELAY_RETRYABLE: readonly RegExp[] = [
  /上游.{0,8}(错误|异常|繁忙|超时|不可用|负载|饱和|无响应|失败|断开|中断)/,
  /超时/,
  /繁忙|忙碌/,
  /稍后(再|重)?试/,
  /过载|负载(过高|已满|较高)|已饱和/,
  /请求(过多|太多|过于频繁|太频繁|频繁)|限流|频率(超限|过高)/,
  /网络(错误|异常|波动|不稳定|中断)|连接(失败|中断|断开|异常|超时|被重置|重置|被关闭|被拒绝)/,
  /(服务|暂时)不可用/,
  /upstream.{0,24}(error|unavailable|overload|busy|closed|reset|fail)/i,
  /no healthy upstream/i,
  /bad.?gateway/i,
  /time-out/i,
  /\bbusy\b/i,
  /try again later|retry later|please try again/i,
  /temporarily (unavailable|overloaded)/i,
  /(at|over) capacity/i,
  /ECONNRESET|ECONNABORTED|ETIMEDOUT|EPIPE|connection.?reset/i,
  /\b52[0-3]\b/,
  /throttl/i,
  /overload/i,
];

/** The key, the balance, the request itself, or the content: retrying only repeats the failure. */
export const RELAY_NEVER: readonly RegExp[] = [
  // A 4xx status, as pi-ai writes it in front of the body ("401: …", "401 …", "OpenAI API error (401): …"): the service
  // refused this very request, whatever the relay's wording calls it, and the same request is refused again.
  // 408, 409, 425 and 429 are the four that can pass.
  /^4(?!08|09|25|29)\d\d[\s:]|\(4(?!08|09|25|29)\d\d\)/,
  /额度|余额|欠费|充值|配额|账单|quota|balance|billing|credit|insufficient|payment/i,
  /令牌|密钥|api.?key|invalid.?token|token.?(invalid|expired)|unauthori[sz]ed|forbidden|permission|无权|权限|鉴权|认证/i,
  /invalid|not supported|unsupported|not found|does not exist|不支持|不存在|未找到|无效|非法|格式错误|参数错误/i,
  /content.?filter|moderation|safety|inappropriate|sensitive|\brisk|审核|违规|违禁|敏感|风险/i,
  // The account or the user's region was refused, not the moment. A region that is only busy (「该地区节点繁忙」) is still retried.
  /封禁|banned|suspend|disabled|deactivat|所在的?地区|地区不(可用|支持)|不可用于.{0,8}地区|not (available|supported) in your (region|country|location)|unsupported (region|country|location)|(region|country|location) (is )?not supported/i,
  /context|上下文|too long|过长|max.?tokens/i,
];

/** Added to a relay's temporary failure: plain words for the user, and a phrase pi-ai's retry list knows. */
export const RETRY_NOTE = '（这是临时错误，可以重试 · you can retry your request）';

/** The failure with the note added when pi should retry it but would not; otherwise undefined, and the message stays as it was. */
export function retryableRelayError(message: AssistantMessage, contextWindow: number): AssistantMessage | undefined {
  if (message.stopReason !== 'error' || !message.errorMessage) return undefined;
  // pi retries it already, or compaction handles it.
  if (isRetryableAssistantError(message) || isContextOverflow(message, contextWindow)) return undefined;
  const text = message.errorMessage;
  if (RELAY_NEVER.some(pattern => pattern.test(text)) || !RELAY_RETRYABLE.some(pattern => pattern.test(text))) return undefined;
  return { ...message, errorMessage: `${text}\n${RETRY_NOTE}` };
}

export function createRelayRetryExtension(contextWindow: number): ExtensionFactory {
  return pi => {
    pi.on('message_end', event => {
      if (event.message.role !== 'assistant') return undefined;
      const message = retryableRelayError(event.message as AssistantMessage, contextWindow);
      return message ? { message } : undefined;
    });
  };
}
