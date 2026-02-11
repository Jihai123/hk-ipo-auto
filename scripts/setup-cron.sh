#!/bin/bash
# 设置定时任务 - 每天早上9点自动更新IPO数据并评分

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "======================================"
echo "港股IPO自动爬虫 - 定时任务设置"
echo "======================================"
echo ""

# 检查node是否安装
if ! command -v node &> /dev/null; then
    echo "❌ 错误: Node.js 未安装"
    exit 1
fi

# 生成cron任务
CRON_JOB="0 9 * * * cd $PROJECT_DIR && node scripts/auto-crawler.js --score >> /tmp/ipo-crawler.log 2>&1"

echo "将添加以下定时任务："
echo "--------------------------------------"
echo "$CRON_JOB"
echo "--------------------------------------"
echo ""
echo "说明："
echo "  - 每天早上9:00自动运行"
echo "  - 自动爬取最新IPO列表"
echo "  - 自动为新股评分"
echo "  - 日志保存到 /tmp/ipo-crawler.log"
echo ""

read -p "确认添加？(y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    # 添加到crontab
    (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
    echo "✅ 定时任务已添加"
    echo ""
    echo "查看当前任务："
    crontab -l | grep "auto-crawler"
    echo ""
    echo "手动测试运行："
    echo "  node scripts/auto-crawler.js --score"
else
    echo "❌ 已取消"
fi
