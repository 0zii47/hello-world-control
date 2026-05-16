import { checkCdpAvailable, findWhatsAppTarget } from "./cdp-client.js";

/**
 * 将任意 JS 值安全转义为可嵌入 <script> 的 JSON 字面量。
 * JSON.stringify 已处理所有特殊字符（引号、反斜杠、换行等），无需额外 replace。
 */
export function safeJs(value) {
  return JSON.stringify(value);
}

/**
 * 统一成功响应格式。
 */
export function makeResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * 统一错误响应格式。可选 remediation 提示。
 */
export function makeError(message, remediation) {
  const body = { error: message };
  if (remediation) body.remediation = remediation;
  return {
    content: [{ type: "text", text: JSON.stringify(body) }],
  };
}

/**
 * 检查 CDP 可用性并查找 WhatsApp webview 目标。
 * 成功返回 { target }；失败返回错误响应，调用方应直接 return。
 */
export async function ensureWhatsAppTarget(port) {
  if (!(await checkCdpAvailable(port))) {
    return {
      errorResponse: makeError(
        `CDP 端口 ${port} 不可用。`,
        "请先用 'launch_app_with_debug' 工具以调试模式重启应用。"
      ),
    };
  }
  const targets = await findWhatsAppTarget(port);
  if (targets.length === 0) {
    return {
      errorResponse: makeError(
        "未找到 WhatsApp webview。请在 HelloWorld 中打开 WhatsApp 面板。"
      ),
    };
  }
  return { target: targets[0] };
}
