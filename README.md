# HelloWorld MCP Server

MCP (Model Context Protocol) 服务器，用于通过 CDP (Chrome DevTools Protocol) 控制 **HelloWorld跨境电商助手** 中的 WhatsApp 和 Telegram 消息。

## 前置要求

- **Node.js 18+**
- **HelloWorld跨境电商助手** 已安装并登录 WhatsApp/Telegram

## 快速开始

```bash
# 克隆并安装
git clone https://github.com/0zii47/hello-world-control.git
cd hello-world-control
bash setup.sh
```

## MCP 工具列表

### CDP 连接管理
- `launch_app_with_debug` — 以 `--remote-debugging-port=9222` 启动 HelloWorld 应用

### WhatsApp 工具
- `get_whatsapp_chats` — 所有聊天列表（含最后一条消息预览和 LID）
- `get_whatsapp_messages` — 读取指定聊天的消息
- `get_whatsapp_contacts` — 搜索/列出联系人
- `get_whatsapp_unread` — 未读消息汇总
- `export_whatsapp_chat` — 导出完整聊天记录（TXT + JSON 双格式）
  - 使用 **Store.Msg** 获取全部历史消息（比 chat.msgs 更完整）
  - 支持 `contact_number`（号码模糊匹配）或 `chat_lid`（LID 直接搜索）
  - 返回统计摘要：每日分布、类型分布、收发比例

## 配置 MCP 客户端

在 Claude Desktop 或其它 MCP 客户端中添加：

```json
{
  "mcpServers": {
    "helloworld": {
      "command": "node",
      "args": ["/path/to/hello-world-control/index.js"]
    }
  }
}
```

## CDP 模式

HelloWorld 应用需要以调试模式启动才能使用 WhatsApp 工具：

```bash
# macOS
/Applications/HelloWorld跨境电商助手.app/Contents/MacOS/HelloWorld跨境电商助手 --remote-debugging-port=9222
```

或使用 `launch_app_with_debug` 工具自动启动。

## 架构

- `index.js` — MCP server 入口，注册所有工具
- `cdp-client.js` — CDP 连接辅助模块（查找 webview、执行 JS）
