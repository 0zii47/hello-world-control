import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import {
  findWhatsAppTarget,
  executeInWebView,
  checkCdpAvailable,
} from "./cdp-client.js";

const HOME = homedir();
const APP_NAME = "HelloWorld跨境电商助手";
const APP_PATH = `/Applications/${APP_NAME}.app`;
const DATA_DIR = join(HOME, "Library/Application Support", APP_NAME);
const CONFIG_PATH = join(DATA_DIR, "config");
const FRIENDS_CACHE_PATH = join(DATA_DIR, "Friends Cache");

// ---- helpers ----

function readConfig() {
  if (!existsSync(CONFIG_PATH)) return null;
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
}

function writeConfig(config) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, "\t"));
}

function getAppProcess() {
  try {
    const out = execSync(`pgrep -fl "${APP_NAME}"`, { encoding: "utf-8", timeout: 3000 });
    const lines = out.trim().split("\n").filter(Boolean);
    const processes = [];
    for (const line of lines) {
      const [pid, ...rest] = line.split(" ");
      processes.push({ pid: parseInt(pid), command: rest.join(" ") });
    }
    return processes;
  } catch {
    return [];
  }
}

function getListeningPorts() {
  try {
    const pids = getAppProcess().map((p) => p.pid);
    if (pids.length === 0) return [];
    const out = execSync(
      `lsof -i -P -n 2>/dev/null | grep -E "${pids.join("|")}" | grep LISTEN`,
      { encoding: "utf-8", timeout: 3000 }
    );
    const ports = [];
    for (const line of out.trim().split("\n")) {
      const m = line.match(/:(\d+) \(LISTEN\)/);
      if (m) ports.push(parseInt(m[1]));
    }
    return [...new Set(ports)];
  } catch {
    return [];
  }
}

// ---- server ----

const server = new McpServer(
  {
    name: "helloworld-mcp-server",
    version: "1.0.0",
  },
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
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "未找到配置文件，应用可能尚未运行过。" }),
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(config, null, 2),
        },
      ],
    };
  }
);

// 2. 更新应用配置
server.registerTool(
  "update_config",
  {
    description:
      "更新 HelloWorld 应用配置。可修改的设置包括：窗口置顶 (always_on_top)、自动启动 (auto_launch)、代理设置 (proxy, proxyHost, proxyPort)、语言 (locale)、干扰模式 (dont_disturb) 等。",
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
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "配置文件不存在，无法更新。请先运行应用。" }),
          },
        ],
      };
    }
    Object.assign(config, updates);
    writeConfig(config);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ success: true, config }, null, 2),
        },
      ],
    };
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
    const processes = getAppProcess();
    const ports = getListeningPorts();
    const config = readConfig();

    const status = {
      running: processes.length > 0,
      processes,
      listening_ports: ports,
      data_directory: DATA_DIR,
      config_exists: config !== null,
      config_summary: config
        ? { locale: config.locale, proxy: config.proxy, auto_launch: config.auto_launch, version: config.version }
        : null,
    };

    return {
      content: [
        { type: "text", text: JSON.stringify(status, null, 2) },
      ],
    };
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
    const processes = getAppProcess();
    if (processes.length > 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              message: "应用已在运行中。",
              processes,
            }),
          },
        ],
      };
    }
    try {
      execSync(`open "${APP_PATH}"`, { timeout: 5000 });
      return {
        content: [
          { type: "text", text: JSON.stringify({ success: true, message: "应用已启动。" }) },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "无法启动应用。", detail: e.message }),
          },
        ],
      };
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
    const processes = getAppProcess();
    if (processes.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ message: "应用未在运行。" }),
          },
        ],
      };
    }
    try {
      for (const p of processes) {
        execSync(`kill ${p.pid}`, { timeout: 3000 });
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `已退出 ${processes.length} 个进程。` }),
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "退出应用时出错。", detail: e.message }),
          },
        ],
      };
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
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ message: "暂无好友缓存数据。" }),
          },
        ],
      };
    }
    const data = JSON.parse(readFileSync(FRIENDS_CACHE_PATH, "utf-8"));
    return {
      content: [
        { type: "text", text: JSON.stringify(data, null, 2) },
      ],
    };
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
        return {
          content: [
            { type: "text", text: JSON.stringify({ error: `无法获取 ${provider} 语言配置。HTTP ${resp.status}` }) },
          ],
        };
      }
      const data = await resp.json();
      return {
        content: [
          { type: "text", text: JSON.stringify({ provider, languages: data }, null, 2) },
        ],
      };
    } catch (e) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ error: e.message }) },
        ],
      };
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
      const url =
        "https://s3.client.update.helloworldtranslate.com/update/store/all.json";
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) {
        // fallback: read local store
        const localStore = join(
          "/tmp/helloworld_extract/store/all.json"
        );
        if (existsSync(localStore)) {
          const data = JSON.parse(readFileSync(localStore, "utf-8"));
          const platforms = data.map((p) => ({
            id: p.id,
            name: p.name,
            url: p.url,
            type: p.type,
            version: p.version,
          }));
          return {
            content: [
              { type: "text", text: JSON.stringify({ platforms, source: "local" }, null, 2) },
            ],
          };
        }
        return {
          content: [
            { type: "text", text: JSON.stringify({ error: "无法获取平台列表。" }) },
          ],
        };
      }
      const data = await resp.json();
      const platforms = data.map((p) => ({
        id: p.id,
        name: p.name,
        url: p.url,
        type: p.type,
        version: p.version,
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ platforms, source: "remote" }, null, 2),
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ error: e.message }) },
        ],
      };
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
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                reachable: true,
                status: resp.status,
                response: data,
                note: "API 可达。完整功能（订单查询、联系人管理等）需要登录令牌。",
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              reachable: false,
              error: e.message,
              note: "远程 API 不可达。请检查网络连接。",
            }),
          },
        ],
      };
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
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "LevelDB 数据目录不存在。" }),
          },
        ],
      };
    }
    try {
      const script = `
import sys
sys.path.insert(0, '${join(HOME, "Library/Python/3.9/lib/python/site-packages")}')
try:
    import plyvel
    db = plyvel.DB('${leveldbPath}', create_if_missing=False)
    keys = []
    for key, value in db:
        key_str = key.decode('utf-8', errors='replace')
        if '${format}' == 'raw':
            val_str = value.decode('utf-8', errors='replace')[:500]
            keys.append({'key': key_str, 'value_preview': val_str})
        else:
            keys.append(key_str)
    db.close()
    print(json.dumps({'found': len(keys), 'keys': keys}))
except ImportError:
    print(json.dumps({'error': 'plyvel 未安装。请运行: pip3 install plyvel'}))
except Exception as e:
    print(json.dumps({'error': str(e)}))
`;
      const result = execSync(`python3 -c "${script.replace(/"/g, '\\"')}"`, {
        encoding: "utf-8",
        timeout: 5000,
      });
      const data = JSON.parse(result.trim());
      return {
        content: [
          { type: "text", text: JSON.stringify(data, null, 2) },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "读取 LevelDB 失败。", detail: e.message }),
          },
        ],
      };
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
      port: z
        .number()
        .optional()
        .default(9222)
        .describe("CDP 调试端口，默认 9222"),
    },
  },
  async ({ port }) => {
    // First quit existing instances
    const processes = getAppProcess();
    if (processes.length > 0) {
      for (const p of processes) {
        try {
          execSync(`kill ${p.pid}`, { timeout: 3000 });
        } catch {}
      }
      // Wait for shutdown
      await new Promise((r) => setTimeout(r, 2000));
    }
    try {
      execSync(`open -n "${APP_PATH}" --args --remote-debugging-port=${port}`, {
        timeout: 5000,
      });
      // Wait for CDP to become available
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await checkCdpAvailable(port)) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: true,
                  message: `应用已以 CDP 模式启动，端口 ${port}`,
                  cdp_url: `http://localhost:${port}/json`,
                }),
              },
            ],
          };
        }
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `应用已启动，但 CDP 端口 ${port} 尚未就绪。请等待 WhatsApp 加载完成后重试。`,
            }),
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "启动应用失败。", detail: e.message }),
          },
        ],
      };
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
      port: z
        .number()
        .optional()
        .default(9222)
        .describe("CDP 调试端口，默认 9222"),
      include_unread_only: z
        .boolean()
        .optional()
        .default(false)
        .describe("只返回有未读消息的聊天"),
    },
  },
  async ({ port, include_unread_only }) => {
    if (!(await checkCdpAvailable(port))) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `CDP 端口 ${port} 不可用。`,
              remediation:
                "请先用 'launch_app_with_debug' 工具以调试模式重启应用，或手动启动: open -n /Applications/HelloWorld跨境电商助手.app --args --remote-debugging-port=9222",
            }),
          },
        ],
      };
    }
    const targets = await findWhatsAppTarget(port);
    if (targets.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "未找到 WhatsApp webview。请在 HelloWorld 中打开 WhatsApp 面板。",
              available_targets: `请检查 http://localhost:${port}/json 查看所有可调试页面。`,
            }),
          },
        ],
      };
    }

    const expression = `
(async () => {
  try {
    // Primary: WhatsApp Store API (always available once WhatsApp loads)
    if (typeof Store !== 'undefined' && Store.Chat) {
      const chats = Store.Chat.getModelsArray();
      const result = [];
      for (const c of chats) {
        if (!c.id) continue;
        // Load last message body from msgs collection
        let lastMsgBody = null;
        let lastMsgTime = c.t || null;
        try {
          const msgs = c.msgs.getModelsArray();
          if (msgs.length > 0) {
            const lm = msgs[msgs.length - 1];
            lastMsgBody = lm.body?.substring(0, 300) || null;
            lastMsgTime = lm.t || lastMsgTime;
          }
        } catch {}
        result.push({
          id: c.id._serialized || c.id,
          name: c.name || c.formattedTitle || '(unknown)',
          unreadCount: c.unreadCount || 0,
          isGroup: c.isGroup || false,
          isMuted: c.muteExpiration > 0,
          lastMessage: lastMsgBody,
          timestamp: lastMsgTime,
        });
      }
      // Sort by timestamp descending
      result.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      return result;
    }

    // Fallback: WAPLUS_WPP
    if (window.WAPLUS_WPP && window.WAPLUS_WPP.chat) {
      const chats = await window.WAPLUS_WPP.chat.list();
      return chats.map(c => {
        const id = typeof c.id === 'object' ? c.id._serialized : c.id;
        return {
          id, name: c.name || c.formattedTitle || '(unknown)',
          unreadCount: c.unreadCount || 0,
          isGroup: c.isGroup || false,
          isMuted: c.muteExpiration > 0,
          lastMessage: c.lastMessage?.body?.substring(0, 300) || null,
          timestamp: c.timestamp || c.lastMessage?.timestamp || null,
        };
      });
    }

    return { error: 'WhatsApp 尚未加载。请等待几秒后重试。' };
  } catch(e) {
    return { error: e.message };
  }
})()
`;

    try {
      const result = await executeInWebView(targets[0].id, expression, port);
      let data;
      try {
        data = JSON.parse(result.result.value);
      } catch {
        data = result.result.value;
      }
      if (include_unread_only && Array.isArray(data)) {
        data = data.filter((c) => c.unreadCount > 0);
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                total_chats: Array.isArray(data) ? data.length : 0,
                whatsapp_target: targets[0].url,
                chats: data,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "CDP 执行失败。", detail: e.message }),
          },
        ],
      };
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
      chat_id: z
        .string()
        .describe("WhatsApp 聊天 ID，例如 861234567890@c.us"),
      count: z
        .number()
        .optional()
        .default(30)
        .describe("读取最近多少条消息，默认 30"),
      port: z
        .number()
        .optional()
        .default(9222)
        .describe("CDP 调试端口，默认 9222"),
    },
  },
  async ({ chat_id, count, port }) => {
    if (!(await checkCdpAvailable(port))) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `CDP 端口 ${port} 不可用。`,
              remediation:
                "请先用 'launch_app_with_debug' 工具以调试模式重启应用。",
            }),
          },
        ],
      };
    }
    const targets = await findWhatsAppTarget(port);
    if (targets.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "未找到 WhatsApp webview。请在 HelloWorld 中打开 WhatsApp 面板。",
            }),
          },
        ],
      };
    }

    const expression = `
(async () => {
  const chatId = '${chat_id.replace(/'/g, "\\'")}';
  const count = ${count};

  try {
    // Primary: WhatsApp Store API
    if (typeof Store !== 'undefined' && Store.Chat) {
      const chat = Store.Chat.get(chatId);
      if (!chat) return { error: '未找到聊天: ' + chatId };
      const msgs = chat.msgs.getModelsArray();
      const recent = msgs.slice(-count).reverse();
      return recent.map(m => ({
        id: m.id?._serialized || m.id,
        body: m.body || '',
        type: m.type || 'text',
        from: m.from?._serialized || m.author,
        timestamp: m.t,
        hasMedia: !!(m.mediaData || m.deprecatedMms3Url),
        isForwarded: !!m.isForwarded,
        isFromMe: !!(m.id?.fromMe || m.fromMe),
      }));
    }

    // Fallback: WAPLUS_WPP
    if (window.WAPLUS_WPP && window.WAPLUS_WPP.chat) {
      const messages = await window.WAPLUS_WPP.chat.getMessages(chatId, { count });
      if (!messages || !Array.isArray(messages)) {
        return { error: 'WAPLUS_WPP 未返回消息数组' };
      }
      return messages.map(m => ({
        id: typeof m.id === 'object' ? m.id._serialized : m.id,
        body: m.body || '', type: m.type || 'text',
        from: typeof m.from === 'object' ? m.from._serialized : m.author,
        timestamp: m.timestamp || m.t,
        hasMedia: !!(m.mediaData || m.deprecatedMms3Url || m.mmUrl),
        isForwarded: !!m.isForwarded,
        isFromMe: !!(m.fromMe || m.isFromMe || (typeof m.id === 'object' && m.id.fromMe)),
      }));
    }

    return { error: 'WhatsApp 尚未加载。请等待几秒后重试。' };
  } catch(e) {
    return { error: e.message };
  }
})()
`;

    try {
      const result = await executeInWebView(targets[0].id, expression, port);
      let data;
      try {
        data = JSON.parse(result.result.value);
      } catch {
        data = result.result.value;
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                chat_id,
                message_count: Array.isArray(data) ? data.length : 0,
                messages: data,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "CDP 执行失败。", detail: e.message }),
          },
        ],
      };
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
      query: z
        .string()
        .optional()
        .describe("按姓名或号码搜索联系人，留空返回所有联系人"),
      limit: z
        .number()
        .optional()
        .default(100)
        .describe("最多返回多少个联系人"),
      port: z
        .number()
        .optional()
        .default(9222)
        .describe("CDP 调试端口，默认 9222"),
    },
  },
  async ({ query, limit, port }) => {
    if (!(await checkCdpAvailable(port))) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `CDP 端口 ${port} 不可用。`,
              remediation:
                "请先用 'launch_app_with_debug' 工具以调试模式重启应用。",
            }),
          },
        ],
      };
    }
    const targets = await findWhatsAppTarget(port);
    if (targets.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "未找到 WhatsApp webview。",
            }),
          },
        ],
      };
    }

    const expression = `
(async () => {
  const q = '${(query || "").replace(/'/g, "\\'")}';
  const limit = ${limit};

  try {
    // Primary: WhatsApp Store API
    if (typeof Store !== 'undefined' && Store.Contact) {
      const contacts = Store.Contact.getModelsArray();
      let filtered = contacts;
      if (q) {
        const lower = q.toLowerCase();
        filtered = contacts.filter(c =>
          (c.name || c.formattedName || c.pushname || '').toLowerCase().includes(lower) ||
          (c.number || c.userid || '').includes(q)
        );
      }
      return filtered.slice(0, limit).map(c => ({
        id: c.id?._serialized || c.id,
        name: c.name || c.formattedName || c.pushname || '',
        number: c.number || c.userid || '',
        isBusiness: c.isBusiness || false,
        isMe: c.isMe || false,
        isBlocked: c.isBlocked || false,
      }));
    }

    // Fallback: WAPLUS_WPP
    if (window.WAPLUS_WPP && window.WAPLUS_WPP.contact) {
      let contacts;
      if (q) {
        contacts = await window.WAPLUS_WPP.contact.get(q);
        contacts = contacts ? [contacts] : [];
      } else {
        contacts = await window.WAPLUS_WPP.contact.list();
      }
      if (!contacts) return [];
      return contacts.slice(0, limit).map(c => ({
        id: typeof c.id === 'object' ? c.id._serialized : c.id,
        name: c.name || c.formattedName || c.pushname || '',
        number: c.number || c.userid || '',
        isBusiness: c.isBusiness || false,
        isMe: c.isMe || false,
        isBlocked: c.isBlocked || false,
      }));
    }

    return { error: 'WhatsApp 尚未加载。请等待几秒后重试。' };
  } catch(e) {
    return { error: e.message };
  }
})()
`;

    try {
      const result = await executeInWebView(targets[0].id, expression, port);
      let data;
      try {
        data = JSON.parse(result.result.value);
      } catch {
        data = result.result.value;
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query: query || "(all)",
                count: Array.isArray(data) ? data.length : 0,
                contacts: data,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "CDP 执行失败。", detail: e.message }),
          },
        ],
      };
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
      port: z
        .number()
        .optional()
        .default(9222)
        .describe("CDP 调试端口，默认 9222"),
    },
  },
  async ({ port }) => {
    if (!(await checkCdpAvailable(port))) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `CDP 端口 ${port} 不可用。`,
              remediation:
                "请先用 'launch_app_with_debug' 工具以调试模式重启应用。",
            }),
          },
        ],
      };
    }
    const targets = await findWhatsAppTarget(port);
    if (targets.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "未找到 WhatsApp webview。",
            }),
          },
        ],
      };
    }

    const expression = `
(async () => {
  try {
    // Primary: WhatsApp Store API
    if (typeof Store !== 'undefined' && Store.Chat) {
      const chats = Store.Chat.getModelsArray();
      const unread = chats
        .filter(c => c.unreadCount > 0)
        .map(c => {
          const id = c.id?._serialized || c.id;
          // Load last message body
          let lastMsgBody = null;
          let lastMsgTime = c.t || null;
          try {
            const msgs = c.msgs.getModelsArray();
            if (msgs.length > 0) {
              const lm = msgs[msgs.length - 1];
              lastMsgBody = lm.body?.substring(0, 300) || null;
              lastMsgTime = lm.t || lastMsgTime;
            }
          } catch {}
          return {
            id, name: c.name || c.formattedTitle || '(unknown)',
            unreadCount: c.unreadCount,
            isGroup: c.isGroup || false,
            isMuted: c.muteExpiration > 0,
            lastMessage: lastMsgBody,
            timestamp: lastMsgTime,
          };
        })
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      return {
        total_unread_chats: unread.length,
        total_unread_messages: unread.reduce((s, c) => s + c.unreadCount, 0),
        unread_chats: unread,
      };
    }

    // Fallback: WAPLUS_WPP
    if (window.WAPLUS_WPP && window.WAPLUS_WPP.chat) {
      const chats = await window.WAPLUS_WPP.chat.list();
      const unread = chats
        .filter(c => c.unreadCount > 0)
        .map(c => {
          const id = typeof c.id === 'object' ? c.id._serialized : c.id;
          return {
            id, name: c.name || c.formattedTitle || '(unknown)',
            unreadCount: c.unreadCount,
            isGroup: c.isGroup || false,
            isMuted: c.muteExpiration > 0,
            lastMessage: c.lastMessage?.body?.substring(0, 300) || null,
            timestamp: c.lastMessage?.timestamp || null,
          };
        })
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      return {
        total_unread_chats: unread.length,
        total_unread_messages: unread.reduce((s, c) => s + c.unreadCount, 0),
        unread_chats: unread,
      };
    }

    return { error: 'WhatsApp 尚未加载。请等待几秒后重试。' };
  } catch(e) {
    return { error: e.message };
  }
})()
`;

    try {
      const result = await executeInWebView(targets[0].id, expression, port);
      let data;
      try {
        data = JSON.parse(result.result.value);
      } catch {
        data = result.result.value;
      }
      return {
        content: [
          { type: "text", text: JSON.stringify(data, null, 2) },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "CDP 执行失败。", detail: e.message }),
          },
        ],
      };
    }
  }
);

// 16. 导出 WhatsApp 聊天记录到文件
server.registerTool(
  "export_whatsapp_chat",
  {
    description:
      "导出指定 WhatsApp 联系人的全部聊天记录到文件。按联系人号码模糊匹配聊天，读取全部消息，格式化为文本文件保存到桌面。",
    inputSchema: {
      contact_number: z
        .string()
        .describe("联系人号码，模糊匹配。如 '7608675' 匹配 +1 (570) 760-8675"),
      output_dir: z
        .string()
        .optional()
        .describe("输出目录，默认桌面"),
      port: z
        .number()
        .optional()
        .default(9222)
        .describe("CDP 调试端口，默认 9222"),
    },
  },
  async ({ contact_number, output_dir, port }) => {
    if (!(await checkCdpAvailable(port))) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `CDP 端口 ${port} 不可用。`,
              remediation:
                "请先用 'launch_app_with_debug' 工具以调试模式重启应用。",
            }),
          },
        ],
      };
    }
    const targets = await findWhatsAppTarget(port);
    if (targets.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "未找到 WhatsApp webview。请在 HelloWorld 中打开 WhatsApp 面板。",
            }),
          },
        ],
      };
    }

    const outputPath = output_dir || join(HOME, "Desktop");

    // Step 1: Find contact, open chat, read messages via CDP
    const findExpression = `
(async () => {
  const num = '${contact_number.replace(/'/g, "\\'")}';
  try {
    if (typeof Store === 'undefined' || !Store.Contact) {
      return JSON.stringify({ error: 'WhatsApp Store 尚未加载，请等待几秒后重试。' });
    }

    // Search Store.Contact for matching number
    const contacts = Store.Contact.getModelsArray();
    const match = contacts.find(c => {
      const id = (c.id?._serialized || c.id || '').replace(/[@c.us@g.us]/g, '');
      const clean = id.replace(/[+\\s()-]/g, '');
      return clean.includes(num);
    });

    if (!match) {
      const sampleIds = contacts.slice(0, 10).map(c => c.id?._serialized || c.id || '');
      return JSON.stringify({ error: '未找到匹配联系人: ' + num, total_contacts: contacts.length, sample_ids: sampleIds });
    }

    const chatId = match.id?._serialized || match.id;
    const chatName = match.name || match.formattedName || match.pushname || '';

    // Open chat window to trigger message loading
    if (typeof window.openChatWindow === 'function') {
      await window.openChatWindow(chatId);
    }

    // Wait for messages to load (async)
    await new Promise(r => setTimeout(r, 2000));

    // Read messages from Store.Msg (reliable, covers unloaded chats)
    let messages = [];
    if (Store.Msg) {
      const allMsgs = Store.Msg.getModelsArray();
      const chatMsgs = allMsgs.filter(m => {
        const from = m.from?._serialized || m.from || '';
        const to = m.to?._serialized || m.to || '';
        return from === chatId || to === chatId;
      });
      // Note: sort is done in Node.js after parsing, more reliable
      messages = chatMsgs.map(m => ({
        id: m.id?._serialized || m.id,
        body: m.body || '',
        type: m.type || 'text',
        from: m.from?._serialized || m.from || '',
        timestamp: m.t,
        hasMedia: !!(m.mediaData || m.deprecatedMms3Url || m.mmUrl),
        isFromMe: !!(m.id?.fromMe || m.fromMe),
      }));
    } else {
      // Fallback: try chat.msgs
      const chat = Store.Chat.get(chatId);
      if (chat) {
        const msgs = chat.msgs.getModelsArray();
        messages = msgs.map(m => ({
          id: m.id?._serialized || m.id,
          body: m.body || '',
          type: m.type || 'text',
          from: m.from?._serialized || m.author || '',
          timestamp: m.t,
          hasMedia: !!(m.mediaData || m.deprecatedMms3Url),
          isFromMe: !!(m.id?.fromMe || m.fromMe),
        }));
      }
    }

    return JSON.stringify({ chatId, chatName, totalMessages: messages.length, messages });
  } catch(e) {
    return JSON.stringify({ error: e.message });
  }
})()
`;

    try {
      const result = await executeInWebView(targets[0].id, findExpression, port);
      let data;
      try {
        data = JSON.parse(result.result.value);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "解析 CDP 返回数据失败。",
                raw: String(result.result.value).substring(0, 500),
              }),
            },
          ],
        };
      }

      if (data.error) {
        return {
          content: [
            { type: "text", text: JSON.stringify(data, null, 2) },
          ],
        };
      }

      // Sort messages by timestamp (Node.js side, more reliable than in-CDP sort)
      if (data.messages && Array.isArray(data.messages)) {
        data.messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      }

      // Step 2: Format and write to file (grouped by date)
      const lines = [];
      lines.push(`=== ${data.chatName} (${data.chatId}) 聊天记录 ===`);
      lines.push(`导出时间: ${new Date().toLocaleString("zh-CN")}`);
      lines.push(`消息总数: ${data.totalMessages}`);
      lines.push("");

      let lastDate = "";
      for (const m of data.messages) {
        const dt = m.timestamp ? new Date(m.timestamp * 1000) : null;
        const dateStr = dt ? dt.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" }) : "未知日期";
        const timeStr = dt ? dt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "未知时间";

        // Date group separator
        if (dateStr !== lastDate) {
          lastDate = dateStr;
          lines.push(`--- ${dateStr} ---`);
        }

        const sender = m.isFromMe ? "我" : data.chatName;

        // Map common WhatsApp message types to Chinese labels
        const typeLabel = {
          image: "[图片]", video: "[视频]", sticker: "[贴纸]",
          ptt: "[语音]", audio: "[语音]", document: "[文件]",
          revoked: "[已撤回]", gp2: "[群组通知]",
        }[m.type] || (m.type && m.type !== "text" && m.type !== "chat" ? `[${m.type}]` : "");

        // Build header line: time + sender + optional media label
        const header = typeLabel ? `${timeStr}  ${sender}  ${typeLabel}` : `${timeStr}  ${sender}`;
        lines.push(header);

        const isBase64Media = m.body && (
          m.body.startsWith("/9j/") || m.body.startsWith("iVBOR") ||
          m.body.startsWith("AAAB") || m.body.length > 5000
        );
        if (m.body && !isBase64Media) {
          lines.push(m.body);
        }
        lines.push("");
      }

      const safeName = data.chatName.replace(/[/\\:*?"<>|]/g, "_");
      const fileName = `${safeName}-聊天记录.txt`;
      const filePath = join(outputPath, fileName);
      writeFileSync(filePath, lines.join("\n"), "utf-8");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                file_path: filePath,
                file_name: fileName,
                chat_id: data.chatId,
                chat_name: data.chatName,
                total_messages: data.totalMessages,
                first_message_time: data.messages.length > 0
                  ? new Date(data.messages[0].timestamp * 1000).toLocaleString("zh-CN")
                  : null,
                last_message_time: data.messages.length > 0
                  ? new Date(data.messages[data.messages.length - 1].timestamp * 1000).toLocaleString("zh-CN")
                  : null,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "导出失败。", detail: e.message }),
          },
        ],
      };
    }
  }
);

// ---- start ----

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("HelloWorld MCP Server 已启动。");
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
