#!/bin/bash
set -e

echo "=== HelloWorld MCP Server 一键安装 ==="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "错误: 未找到 Node.js，请先安装 Node.js 18+"
    echo "  brew install node"
    echo "  或访问 https://nodejs.org 下载安装"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
echo "Node.js 版本: $(node -v)"

# Install dependencies
echo ""
echo "正在安装依赖..."
npm install

echo ""
echo "=== 安装完成 ==="
echo ""
echo "在 MCP 客户端中添加以下配置:"
echo ""
echo '  {'
echo '    "mcpServers": {'
echo '      "helloworld": {'
echo '        "command": "node",'
echo '        "args": ["'"$(pwd)"'/index.js"]'
echo '      }'
echo '    }'
echo '  }'
echo ""
echo "CDP 模式启动 HelloWorld 应用:"
echo "  open /Applications/HelloWorld跨境电商助手.app --args --remote-debugging-port=9222"
