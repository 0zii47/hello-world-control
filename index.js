import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import {
  findWhatsAppTarget,
  executeInWebView,
  checkCdpAvailable,
} from "./cdp-client.js";
import { ensureWhatsAppTarget, makeResult, makeError, safeJs } from "./cdp-helpers.js";
import { getChatsExpression } from "./cdp-scripts/get-chats.js";
import { getMessagesExpression } from "./cdp-scripts/get-messages.js";
import { getContactsExpression } from "./cdp-scripts/get-contacts.js";
import { getUnreadExpression } from "./cdp-scripts/get-unread.js";
import { exportChatExpression } from "./cdp-scripts/export-chat.js";

const execAsync = promisify(exec);
const HOME = homedir();
const APP_NAME = "HelloWorld跨境电商助手";
const APP_PATH = `/Applications/${APP_NAME}.app`;
const DATA_DIR = join(HOME, "Library/Application Support", APP_NAME);
const CONFIG_PATH = join(DATA_DIR, "config");
const FRIENDS_CACHE_PATH = join(DATA_DIR, "Friends Cache");
const DESKTOP = join(HOME, "Desktop");

// ---- helpers ----

function readConfig() {
  if (!existsSync(CONFIG_PATH)) return null;
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
}

function writeConfig(config) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, "\t"));
}

async function getAppProcess() {
  try {
    const { stdout } = await execAsync(`pgrep -fl "${APP_NAME}"`, { timeout: 3000 });
    const lines = stdout.trim().split("\n").filter(Boolean);
    return lines.map((line) => {
      const [pid, ...rest] = line.split(" ");
      return { pid: parseInt(pid), command: rest.join(" ") };
    });
  } catch {
    return [];
  }
}

async function getListeningPorts() {
  try {
    const procs = await getAppProcess();
    if (procs.length === 0) return [];
    const pids = procs.map((p) => p.pid);
    const { stdout } = await execAsync(
      `lsof -i -P -n 2>/dev/null | grep -E "${pids.join("|")}" | grep LISTEN`,
      { timeout: 3000 }
    );
    const ports = [];
    for (const line of stdout.trim().split("\n")) {
      const m = line.match(/:(\d+) \(LISTEN\)/);
      if (m) ports.push(parseInt(m[1]));
    }
    return [...new Set(ports)];
  } catch {
    return [];
  }
}

/**
 * 验证输出路径在允许范围内（桌面或其子目录）。
 */
function isSafeOutputPath(dir) {
  const resolved = resolve(dir);
  return resolved === DESKTOP || resolved.startsWith(DESKTOP + "/");
}

// ---- server ----

const server = new McpServer(
  { name: "helloworld-mcp-server", version: "1.1.0" },
  { capabilities: { tools: {} } }
);

// 1. 获取应用配置
server.registerTool(
  "get_config",
  {
    description:
      "读取 HelloWorld跨境电商助手 的应用配置。返回所有当前设置：窗口行为、代理设置、语言、通知偏好等。",
    inputSchema: {},
  },
  async () => {
    const config = readConfig();
    if (!config) {
      return makeError("未找到配置文件，应用可能尚未运行过。");
    }
    return makeResult(config);
  }
);

// 2. 更新应用配置
server.registerTool(
  "update_config",
  {
    description:
      "更新 HelloWorld 应用配置。可修改的设置包括：窗口置顶、自动启动、代理设置、语言、干扰模式等。",
    inputSchema: {
      always_on_top: z.boolean().optional().describe("始终置顶窗口"),
      hide_menu_bar: z.boolean().optional().describe("隐藏菜单栏"),
      auto_launch: z.boolean().optional().describe("开机自启"),
      flash_frame: z.boolean().optional().describe("新消息闪烁提醒"),
      start_minimized: z.boolean().optional().describe("启动时最小化"),
      systemtray_indicator: z.boolean().optional().describe("系统托盘图标"),
      master_password: z.boolean().optional().describe("启用主密码"),
      dont_disturb: z.boolean().optional().describe("免打扰模式"),
      proxy: z.boolean().optional().describe("启用代理"),
      proxyHost: z.string().optional().describe("代理主机地址"),
      proxyPort: z.string().optional().describe("代理端口"),
      proxyLogin: z.string().optional().describe("代理用户名"),
      proxyPassword: z.string().optional().describe("代理密码"),
      locale: z.enum(["zh-CN", "zh-TW", "en"]).optional().describe("界面语言"),
      enable_hidpi_support: z.boolean().optional().describe("HiDPI 支持"),
      disable_hardware_acceleration: z.boolean().optional().describe("禁用硬件加速"),
    },
  },
  async (updates) => {
    const config = readConfig();
    if (!config) {
      return makeError("配置文件不存在，无法更新。请先运行应用。");
    }
    Object.assign(config, updates);
    writeConfig(config);
    return makeResult({ success: true, config });
  }
);

// 3. 检查应用状态
server.registerTool(
  "get_app_status",
  {
    description:
      "检查 HelloWorld 应用运行状态：是否运行中、进程 PID、监听端口、数据目录、配置情况。",
    inputSchema: {},
  },
  async () => {
    const processes = await getAppProcess();
    const ports = await getListeningPorts();
    const config = readConfig();
    return makeResult({
      running: processes.length > 0,
      processes,
      listening_ports: ports,
      data_directory: DATA_DIR,
      config_exists: config !== null,
      config_summary: config
        ? { locale: config.locale, proxy: config.proxy, auto_launch: config.auto_launch, version: config.version }
        : null,
    });
  }
);

// 4. 启动应用
server.registerTool(
  "launch_app",
  {
    description: "启动 HelloWorld跨境电商助手 应用。",
    inputSchema: {},
  },
  async () => {
    const processes = await getAppProcess();
    if (processes.length > 0) {
      return makeResult({ message: "应用已在运行中。", processes });
    }
    try {
      await execAsync(`open "${APP_PATH}"`, { timeout: 5000 });
      return makeResult({ success: true, message: "应用已启动。" });
    } catch (e) {
      return makeError("无法启动应用。", e.message);
    }
  }
);

// 5. 退出应用
server.registerTool(
  "quit_app",
  {
    description: "退出 HelloWorld 应用（正常退出，非强制终止）。",
    inputSchema: {},
  },
  async () => {
    const processes = await getAppProcess();
    if (processes.length === 0) {
      return makeResult({ message: "应用未在运行。" });
    }
    try {
      for (const p of processes) {
        await execAsync(`kill ${p.pid}`, { timeout: 3000 });
      }
      return makeResult({ success: true, message: `已退出 ${processes.length} 个进程。` });
    } catch (e) {
      return makeError("退出应用时出错。", e.message);
    }
  }
);

// 6. 读取好友缓存
server.registerTool(
  "get_friends_cache",
  {
    description: "读取 HelloWorld 的好友/联系人缓存数据（本地缓存的客户信息）。",
    inputSchema: {},
  },
  async () => {
    if (!existsSync(FRIENDS_CACHE_PATH)) {
      return makeResult({ message: "暂无好友缓存数据。" });
    }
    const data = JSON.parse(readFileSync(FRIENDS_CACHE_PATH, "utf-8"));
    return makeResult(data);
  }
);

// 7. 获取翻译语言映射
server.registerTool(
  "get_translation_languages",
  {
    description:
      "获取 HelloWorld 支持的翻译语言映射（百度翻译支持的语言 -> 语言代码）。",
    inputSchema: {
      provider: z
        .enum(["baidu", "youdao", "xiaoniu"])
        .optional()
        .default("baidu")
        .describe("翻译服务商"),
    },
  },
  async ({ provider }) => {
    try {
      const url = `https://cdn.helloword.com.cn/language/${provider}.json`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) {
        return makeError(`无法获取 ${provider} 语言配置。HTTP ${resp.status}`);
      }
      const data = await resp.json();
      return makeResult({ provider, languages: data });
    } catch (e) {
      return makeError(e.message);
    }
  }
);

// 8. 列出支持的平台
server.registerTool(
  "list_supported_platforms",
  {
    description:
      "列出 HelloWorld 支持的所有社交通讯平台（WhatsApp、Telegram、Facebook、Instagram 等 30+ 平台）。",
    inputSchema: {},
  },
  async () => {
    try {
      const url = "https://s3.client.update.helloworldtranslate.com/update/store/all.json";
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const source = resp.ok ? "remote" : "local";
      let data;
      if (resp.ok) {
        data = await resp.json();
      } else {
        const localStore = join("/tmp/helloworld_extract/store/all.json");
        if (!existsSync(localStore)) {
          return makeError("无法获取平台列表。");
        }
        data = JSON.parse(readFileSync(localStore, "utf-8"));
      }
      const platforms = data.map((p) => ({
        id: p.id, name: p.name, url: p.url, type: p.type, version: p.version,
      }));
      return makeResult({ platforms, source });
    } catch (e) {
      return makeError(e.message);
    }
  }
);

// 9. 检测远程 API 连通性
server.registerTool(
  "check_remote_api",
  {
    description:
      "检测 HelloWorld 远程 API (api.helloworlds.cn) 的连通性。需要认证令牌才能访问完整功能。",
    inputSchema: {},
  },
  async () => {
    try {
      const resp = await fetch("https://api.helloworlds.cn/api/ping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      const data = await resp.json();
      return makeResult({
        reachable: true,
        status: resp.status,
        response: data,
        note: "API 可达。完整功能（订单查询、联系人管理等）需要登录令牌。",
      });
    } catch (e) {
      return makeResult({
        reachable: false,
        error: e.message,
        note: "远程 API 不可达。请检查网络连接。",
      });
    }
  }
);

// 10. 读取本地 LevelDB 数据
server.registerTool(
  "read_local_storage",
  {
    description:
      "尝试读取 HelloWorld 的本地 Chromium 存储（LevelDB），包含缓存的会话数据。需要安装 plyvel Python 包。",
    inputSchema: {
      format: z
        .enum(["summary", "raw"])
        .optional()
        .default("summary")
        .describe("输出格式：summary 仅显示键列表，raw 显示完整数据"),
    },
  },
  async ({ format }) => {
    const leveldbPath = join(
      DATA_DIR,
      "Partitions/helloworld_index/Local Storage/leveldb"
    );
    if (!existsSync(leveldbPath)) {
      return makeError("LevelDB 数据目录不存在。");
    }
    try {
      // 动态获取 Python site-packages 路径，避免硬编码 3.9
      const { stdout: sitePath } = await execAsync(
        `python3 -c "import site; print(site.getsitepackages()[0])"`,
        { timeout: 3000 }
      );
      const pkgPath = sitePath.trim();
      const script = [
        "import sys",
        `sys.path.insert(0, ${safeJs(pkgPath)})`,
        "try:",
        "    import plyvel",
        `    db = plyvel.DB(${safeJs(leveldbPath)}, create_if_missing=False)`,
        "    keys = []",
        "    for key, value in db:",
        "        key_str = key.decode('utf-8', errors='replace')",
        `        if ${safeJs(format)} == 'raw':`,
        "            val_str = value.decode('utf-8', errors='replace')[:500]",
        "            keys.append({'key': key_str, 'value_preview': val_str})",
        "        else:",
        "            keys.append(key_str)",
        "    db.close()",
        "    print(json.dumps({'found': len(keys), 'keys': keys}))",
        "except ImportError:",
        "    print(json.dumps({'error': 'plyvel 未安装。请运行: pip3 install plyvel'}))",
        "except Exception as e:",
        "    print(json.dumps({'error': str(e)}))",
      ].join("\n");
      const { stdout } = await execAsync(`python3 -c ${safeJs(script)}`, { timeout: 5000 });
      const data = JSON.parse(stdout.trim());
      return makeResult(data);
    } catch (e) {
      return makeError("读取 LevelDB 失败。", e.message);
    }
  }
);

// ---- CDP-based WhatsApp tools ----

// 11. 以CDP调试模式启动应用
server.registerTool(
  "launch_app_with_debug",
  {
    description:
      "以 Chrome DevTools Protocol 模式启动 HelloWorld 应用（用于读取 WhatsApp 消息等高级操作）。启动前会自动退出当前运行的实例。",
    inputSchema: {
      port: z.number().optional().default(9222).describe("CDP 调试端口，默认 9222"),
    },
  },
  async ({ port }) => {
    const processes = await getAppProcess();
    if (processes.length > 0) {
      for (const p of processes) {
        try { await execAsync(`kill ${p.pid}`, { timeout: 3000 }); } catch {}
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    try {
      await execAsync(`open -n "${APP_PATH}" --args --remote-debugging-port=${port}`, { timeout: 5000 });
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await checkCdpAvailable(port)) {
          return makeResult({
            success: true,
            message: `应用已以 CDP 模式启动，端口 ${port}`,
            cdp_url: `http://localhost:${port}/json`,
          });
        }
      }
      return makeResult({
        success: true,
        message: `应用已启动，但 CDP 端口 ${port} 尚未就绪。请等待 WhatsApp 加载完成后重试。`,
      });
    } catch (e) {
      return makeError("启动应用失败。", e.message);
    }
  }
);

// 12. 获取 WhatsApp 聊天列表
server.registerTool(
  "get_whatsapp_chats",
  {
    description:
      "获取 HelloWorld 中 WhatsApp 的所有聊天列表，包括未读数、最后消息预览等。需要先使用 launch_app_with_debug 以 CDP 模式启动应用。",
    inputSchema: {
      port: z.number().optional().default(9222).describe("CDP 调试端口，默认 9222"),
      include_unread_only: z.boolean().optional().default(false).describe("只返回有未读消息的聊天"),
    },
  },
  async ({ port, include_unread_only }) => {
    const { target, errorResponse } = await ensureWhatsAppTarget(port);
    if (errorResponse) return errorResponse;

    const expression = getChatsExpression({ include_unread_only });
    try {
      const result = await executeInWebView(target.id, expression, port);
      let data;
      try {
        data = JSON.parse(result.result.value);
      } catch {
        data = result.result.value;
      }
      return makeResult({
        total_chats: Array.isArray(data) ? data.length : 0,
        whatsapp_target: target.url,
        chats: data,
      });
    } catch (e) {
      return makeError("CDP 执行失败。", e.message);
    }
  }
);

// 13. 读取 WhatsApp 聊天消息
server.registerTool(
  "get_whatsapp_messages",
  {
    description:
      "读取指定 WhatsApp 聊天的消息内容。需要先用 launch_app_with_debug 启动应用。返回消息正文、发送者、时间戳、媒体信息等。",
    inputSchema: {
      chat_id: z.string().describe("WhatsApp 聊天 ID，例如 861234567890@c.us"),
      count: z.number().optional().default(30).describe("读取最近多少条消息，默认 30"),
      port: z.number().optional().default(9222).describe("CDP 调试端口，默认 9222"),
    },
  },
  async ({ chat_id, count, port }) => {
    const { target, errorResponse } = await ensureWhatsAppTarget(port);
    if (errorResponse) return errorResponse;

    const expression = getMessagesExpression({ chat_id, count });
    try {
      const result = await executeInWebView(target.id, expression, port);
      let data;
      try {
        data = JSON.parse(result.result.value);
      } catch {
        data = result.result.value;
      }
      return makeResult({
        chat_id,
        message_count: Array.isArray(data) ? data.length : 0,
        messages: data,
      });
    } catch (e) {
      return makeError("CDP 执行失败。", e.message);
    }
  }
);

// 14. 获取 WhatsApp 联系人列表
server.registerTool(
  "get_whatsapp_contacts",
  {
    description:
      "搜索或列出 WhatsApp 联系人。需要先用 launch_app_with_debug 启动应用。",
    inputSchema: {
      query: z.string().optional().describe("按姓名或号码搜索联系人，留空返回所有联系人"),
      limit: z.number().optional().default(100).describe("最多返回多少个联系人"),
      port: z.number().optional().default(9222).describe("CDP 调试端口，默认 9222"),
    },
  },
  async ({ query, limit, port }) => {
    const { target, errorResponse } = await ensureWhatsAppTarget(port);
    if (errorResponse) return errorResponse;

    const expression = getContactsExpression({ query, limit });
    try {
      const result = await executeInWebView(target.id, expression, port);
      let data;
      try {
        data = JSON.parse(result.result.value);
      } catch {
        data = result.result.value;
      }
      return makeResult({
        query: query || "(all)",
        count: Array.isArray(data) ? data.length : 0,
        contacts: data,
      });
    } catch (e) {
      return makeError("CDP 执行失败。", e.message);
    }
  }
);

// 15. 获取 WhatsApp 未读消息摘要
server.registerTool(
  "get_whatsapp_unread",
  {
    description:
      "获取 WhatsApp 所有未读消息的摘要：哪些聊天有新消息、消息数量和最后消息内容。需要先用 launch_app_with_debug 启动应用。",
    inputSchema: {
      port: z.number().optional().default(9222).describe("CDP 调试端口，默认 9222"),
    },
  },
  async ({ port }) => {
    const { target, errorResponse } = await ensureWhatsAppTarget(port);
    if (errorResponse) return errorResponse;

    const expression = getUnreadExpression();
    try {
      const result = await executeInWebView(target.id, expression, port);
      let data;
      try {
        data = JSON.parse(result.result.value);
      } catch {
        data = result.result.value;
      }
      return makeResult(data);
    } catch (e) {
      return makeError("CDP 执行失败。", e.message);
    }
  }
);

// 16. 导出 WhatsApp 聊天记录到文件
const CHARACTER_LIMIT = 25000;

server.registerTool(
  "export_whatsapp_chat",
  {
    description:
      "导出指定 WhatsApp 联系人的完整聊天记录到桌面（TXT + JSON 双格式）。\n\n" +
      "使用 Store.Msg（全局消息存储）获取全部历史消息，比 chat.msgs 更完整可靠。\n\n" +
      "两种查找方式（二选一）：\n" +
      "- contact_number: 按号码模糊匹配聊天（如 '7608675' 匹配 +1 (570) 760-8675）\n" +
      "- chat_lid: 直接按 WhatsApp LID 搜索（如 '153902267777180@lid'，速度最快）\n\n" +
      "返回：\n" +
      "- TXT 文件：格式化聊天记录（日期分组、时间戳、发送者标签、媒体类型标签）\n" +
      "- JSON 文件：完整结构化数据（含消息 ID、类型、时间戳、发送者等）\n" +
      "- structuredContent: 统计摘要（总数、时间跨度、每日分布、类型分布、收发比例）\n\n" +
      "使用示例：\n" +
      "- 按号码导出: contact_number='9013027343'\n" +
      "- 按 LID 导出: chat_lid='153902267777180@lid'\n" +
      "- 不知道 LID 时先用 get_whatsapp_chats 获取聊天列表，从中提取 LID",
    inputSchema: z.object({
      contact_number: z.string().optional()
        .describe("联系人号码，模糊匹配。如 '7608675' 匹配 +1 (570) 760-8675。与 chat_lid 二选一"),
      chat_lid: z.string().optional()
        .describe("WhatsApp LID，如 '153902267777180@lid'。直接搜索 Store.Msg，速度最快。与 contact_number 二选一"),
      output_dir: z.string().optional()
        .describe("输出目录，默认桌面"),
      port: z.number().int().min(1024).max(65535).optional().default(9222)
        .describe("CDP 调试端口，默认 9222"),
    }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ contact_number, chat_lid, output_dir, port }) => {
    if (!contact_number && !chat_lid) {
      return makeError("请提供 contact_number 或 chat_lid 参数。", "先用 get_whatsapp_chats 获取聊天列表。");
    }

    const { target, errorResponse } = await ensureWhatsAppTarget(port);
    if (errorResponse) return errorResponse;

    const outputPath = output_dir || DESKTOP;
    if (!isSafeOutputPath(outputPath)) {
      return makeError("输出目录超出允许范围，仅允许桌面及其子目录。");
    }

    const expression = exportChatExpression({ contact_number, chat_lid });
    let data;
    try {
      const result = await executeInWebView(target.id, expression, port);
      try {
        data = JSON.parse(result.result.value);
      } catch {
        return makeError("解析 CDP 返回数据失败。", String(result.result.value).substring(0, 500));
      }
    } catch (e) {
      return makeError("导出失败。", e.message);
    }

    if (data.error) {
      return makeError(data.error);
    }

    const msgs = data.messages || [];
    if (msgs.length === 0) {
      return makeResult({ message: "未找到匹配的消息。该聊天可能没有历史记录。" });
    }

    const total = data.total || msgs.length;
    const chatName = data.chatName || "未知联系人";
    const chatId = data.chatId || "";
    const first = new Date(msgs[0].timestamp * 1000);
    const last = new Date(msgs[msgs.length - 1].timestamp * 1000);

    // Statistics
    const daily = {};
    const typeCounts = {};
    let fromMe = 0;
    for (const m of msgs) {
      const day = new Date(m.timestamp * 1000).toLocaleDateString("zh-CN");
      daily[day] = (daily[day] || 0) + 1;
      typeCounts[m.type] = (typeCounts[m.type] || 0) + 1;
      if (m.isFromMe) fromMe++;
    }

    // Format TXT
    const lines = [];
    lines.push(`=== ${chatName} 完整聊天记录 ===`);
    lines.push(`导出时间: ${new Date().toLocaleString("zh-CN")}`);
    lines.push(`消息总数: ${total}`);
    lines.push(`时间跨度: ${first.toLocaleDateString("zh-CN")} - ${last.toLocaleDateString("zh-CN")}`);
    lines.push(`账号: Jane-868906`);
    lines.push("");

    let lastDate = "";
    for (const m of msgs) {
      const dt = m.timestamp ? new Date(m.timestamp * 1000) : null;
      if (!dt) continue;
      const dateStr = dt.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
      const timeStr = dt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

      if (dateStr !== lastDate) {
        lastDate = dateStr;
        lines.push("");
        lines.push(`--- ${dateStr} ---`);
      }

      const sender = m.isFromMe ? "我" : chatName;
      const typeLabel = {
        image: "[图片]", video: "[视频]", sticker: "[贴纸]",
        ptt: "[语音]", audio: "[语音]", document: "[文件]",
        revoked: "[已撤回]", gp2: "[群组通知]", album: "[相册]",
      }[m.type] || (m.type && m.type !== "text" && m.type !== "chat" ? `[${m.type}]` : "");

      const isBase64Media = m.body && (
        m.body.startsWith("/9j/") || m.body.startsWith("iVBOR") ||
        m.body.startsWith("AAAB") || m.body.length > 5000
      );

      lines.push(`${timeStr}  ${sender}`);
      if (m.body && !isBase64Media && typeLabel) {
        lines.push(`${m.body}  ${typeLabel}`);
      } else if (m.body && !isBase64Media) {
        lines.push(m.body);
      } else if (typeLabel) {
        lines.push(typeLabel);
      }
      if (m.caption && m.caption !== m.body) {
        lines.push(`  [说明: ${m.caption}]`);
      }
      lines.push("");
    }

    const safeName = chatName.replace(/[/\\:*?"<>|]/g, "_");
    const txtFileName = `${safeName}-聊天记录.txt`;
    const jsonFileName = `${safeName}-完整记录.json`;
    const txtPath = join(outputPath, txtFileName);
    const jsonPath = join(outputPath, jsonFileName);

    writeFileSync(txtPath, lines.join("\n"), "utf-8");
    writeFileSync(jsonPath, JSON.stringify({
      exportTime: new Date().toISOString(),
      chatName, chatId,
      account: "Jane-868906",
      totalMessages: total,
      firstDate: first.toISOString(),
      lastDate: last.toISOString(),
      messages: msgs,
    }, null, 2), "utf-8");

    // Build structured response with CHARACTER_LIMIT
    const statsBody = {
      success: true,
      txt_path: txtPath,
      json_path: jsonPath,
      chat_name: chatName,
      chat_id: chatId,
      total_messages: total,
      time_span: {
        first: first.toLocaleString("zh-CN"),
        last: last.toLocaleString("zh-CN"),
      },
      daily_distribution: daily,
      type_distribution: typeCounts,
      sender_ratio: { from_me: fromMe, from_contact: total - fromMe },
    };

    let summaryText = [
      `=== 导出成功: ${chatName} ===`,
      `TXT: ${txtPath}`,
      `JSON: ${jsonPath}`,
      `消息总数: ${total}`,
      `时间跨度: ${first.toLocaleString("zh-CN")} - ${last.toLocaleString("zh-CN")}`,
      `收发比例: 我 ${fromMe} 条 / 对方 ${total - fromMe} 条`,
      `类型: ${Object.entries(typeCounts).map(([k,v]) => `${k}:${v}`).join(", ")}`,
    ].join("\n");

    if (summaryText.length > CHARACTER_LIMIT) {
      summaryText = summaryText.substring(0, CHARACTER_LIMIT) +
        `\n\n[响应已截断（${summaryText.length} 字符）。完整数据请查看导出的文件。]`;
    }

    return {
      content: [{ type: "text", text: summaryText }],
      structuredContent: statsBody,
    };
  }
);

// ---- start ----

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("HelloWorld MCP Server v1.1.0 已启动。");
}

// Graceful shutdown
process.on("SIGINT", () => {
  console.error("收到 SIGINT，正在关闭...");
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.error("收到 SIGTERM，正在关闭...");
  process.exit(0);
});

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
