#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
import traceback
from datetime import datetime

ERROR_PATTERNS = ['接口不存在', '评分失败', '加载失败', '获取失败', 'undefined', 'null', 'NaN']
PLACEHOLDER_PATTERNS = ['暂无数据', 'skeleton', 'loading', '加载中']


def now():
    return datetime.utcnow().isoformat() + 'Z'


def add_issue(report, level, module, location, phenomenon, root_cause, evidence, suggestion):
    report['issues'].append({
        'id': f"ISSUE-{len(report['issues']) + 1:03d}",
        'level': level,
        'module': module,
        'location': location,
        'phenomenon': phenomenon,
        'suspected_root_cause': root_cause,
        'evidence': evidence,
        'suggestion': suggestion,
    })


def text_of(driver, selector):
    script = """
const el = document.querySelector(arguments[0]);
return el ? (el.innerText || '').trim() : '';
"""
    return driver.execute_script(script, selector)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    parser.add_argument('--code', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--artifacts', required=True)
    args = parser.parse_args()

    os.makedirs(args.artifacts, exist_ok=True)
    screenshots_dir = os.path.join(args.artifacts, 'screenshots')
    os.makedirs(screenshots_dir, exist_ok=True)

    report = {
        'meta': {
            'started_at': now(),
            'finished_at': None,
            'url': args.url,
            'code': args.code,
        },
        'executed': False,
        'environment': {
            'chrome_candidates': ['/usr/bin/google-chrome', '/usr/bin/chromium-browser'],
            'chromedriver': '/usr/bin/chromedriver',
            'selected_browser': None,
            'selenium_available': False,
        },
        'checks': {},
        'telemetry': {
            'browser_errors': [],
            'failed_requests': [],
        },
        'issues': [],
        'artifacts': {
            'home_screenshot': os.path.join(screenshots_dir, 'home.png'),
            'score_screenshot': os.path.join(screenshots_dir, 'score-after-click.png'),
            'page_source': os.path.join(args.artifacts, 'page-source.html'),
            'browser_console': os.path.join(args.artifacts, 'browser-console.json'),
            'network_summary': os.path.join(args.artifacts, 'network-summary.json'),
        },
    }

    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.chrome.service import Service
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        report['environment']['selenium_available'] = True
    except Exception as err:
        add_issue(report, 'critical', '浏览器诊断环境', 'python import selenium', 'Selenium 未安装，无法执行真实浏览器诊断。', 'Python 环境缺少 selenium 包。', str(err), '执行: python3 -m pip install selenium')
        report['meta']['finished_at'] = now()
        with open(args.out, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        return

    browser_binary = None
    for candidate in report['environment']['chrome_candidates']:
        if os.path.exists(candidate):
            browser_binary = candidate
            break

    if not browser_binary:
        add_issue(report, 'critical', '浏览器诊断环境', 'browser binary', '未找到可用浏览器二进制。', '系统中不存在 google-chrome/chromium-browser。', 'checked /usr/bin/google-chrome and /usr/bin/chromium-browser', '安装 Chrome/Chromium 后重试。')
        report['meta']['finished_at'] = now()
        with open(args.out, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        return

    if not os.path.exists('/usr/bin/chromedriver'):
        add_issue(report, 'critical', '浏览器诊断环境', '/usr/bin/chromedriver', 'chromedriver 不存在。', '未安装 chromedriver。', 'path not found', '安装 chromedriver 并重试。')
        report['meta']['finished_at'] = now()
        with open(args.out, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        return

    report['environment']['selected_browser'] = browser_binary

    options = Options()
    options.binary_location = browser_binary
    options.add_argument('--headless=new')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--disable-gpu')
    options.add_argument('--window-size=1600,1200')
    options.set_capability('goog:loggingPrefs', {'browser': 'ALL', 'performance': 'ALL'})

    driver = None
    try:
        service = Service('/usr/bin/chromedriver')
        driver = webdriver.Chrome(service=service, options=options)
        wait = WebDriverWait(driver, 20)
        report['executed'] = True

        driver.get(f"{args.url}/hk/")
        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '#scoreForm')))

        driver.save_screenshot(report['artifacts']['home_screenshot'])
        with open(report['artifacts']['page_source'], 'w', encoding='utf-8') as f:
            f.write(driver.page_source)

        top3_text = text_of(driver, '#top3')
        leaderboard_text = text_of(driver, '#leaderboard')
        timeline_text = text_of(driver, '#timeline')
        market_text = text_of(driver, '#market')
        validation_text = text_of(driver, '#validation')

        report['checks']['home_loaded'] = True
        report['checks']['module_text_lengths'] = {
            'top3': len(top3_text),
            'leaderboard': len(leaderboard_text),
            'timeline': len(timeline_text),
            'market': len(market_text),
            'validation': len(validation_text),
        }

        merged_text = '\n'.join([top3_text, leaderboard_text, timeline_text, market_text, validation_text])
        for pattern in ERROR_PATTERNS:
            if pattern in merged_text:
                add_issue(report, 'critical', '前端真实渲染层', '/hk/ text', f'页面出现异常文案: {pattern}', '前端请求失败或渲染异常。', pattern, '检查接口路径、返回结构、前端错误处理。')

        if '暂无数据' in top3_text and '暂无数据' in top3_text.strip():
            add_issue(report, 'critical', '数据完整度', '#top3', 'TOP3 仅显示“暂无数据”。', 'TOP3 数据未成功渲染。', top3_text[:200], '检查 /api/dashboard 与 /api/ipo/top 数据。')

        if '暂无数据' in leaderboard_text and '暂无数据' in leaderboard_text.strip():
            add_issue(report, 'critical', '数据完整度', '#leaderboard', '评分榜仅显示“暂无数据”。', '排行榜数据未成功渲染。', leaderboard_text[:200], '检查 /api/dashboard 与 fallback 数据。')

        for name, selector, content in [
            ('新股时间表', '#timeline', timeline_text),
            ('市场温度', '#market', market_text),
            ('模型验证摘要', '#validation', validation_text),
        ]:
            if not content or any(p in content for p in PLACEHOLDER_PATTERNS):
                add_issue(report, 'major', '数据完整度', selector, f'{name} 模块疑似空壳。', '模块未渲染真实业务内容。', content[:200], '检查 dashboard 聚合字段与前端映射。')

        code_input = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '#codeInput')))
        submit_btn = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, '#scoreForm button[type="submit"]')))
        code_input.clear()
        code_input.send_keys(args.code)
        submit_btn.click()

        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '#scoreResult')))
        driver.implicitly_wait(3)
        score_text = text_of(driver, '#scoreResult')
        report['checks']['score_result_text'] = score_text

        driver.save_screenshot(report['artifacts']['score_screenshot'])

        if not score_text:
            add_issue(report, 'critical', '核心评分链路', '#scoreResult', '点击评分后无结果文本。', '接口调用/渲染流程失败。', '<empty>', '检查 submit 流程和 /api/score/:code 响应。')
        elif '评分失败' in score_text or '接口不存在' in score_text:
            add_issue(report, 'critical', '核心评分链路', '#scoreResult', '评分功能失败。', '接口路径错误或后端返回失败。', score_text[:300], '核对 /api/score/:code 路径与返回字段。')
        else:
            try:
                parsed = json.loads(score_text)
                if not isinstance(parsed, dict):
                    raise ValueError('score result not object')
                if parsed.get('totalScore') is None and parsed.get('total_score') is None:
                    add_issue(report, 'major', '核心评分链路', '#scoreResult', '评分结果缺少总分字段。', '字段命名不一致。', score_text[:300], '统一 totalScore 字段。')
            except Exception:
                add_issue(report, 'major', '核心评分链路', '#scoreResult', '评分结果不是可解析 JSON。', '前端仅输出字符串或格式异常。', score_text[:300], '建议前端结构化渲染总分/维度/解释。')

        browser_logs = []
        try:
            browser_logs = driver.get_log('browser')
        except Exception:
            browser_logs = []
        report['telemetry']['browser_errors'] = [x for x in browser_logs if x.get('level') in ('SEVERE', 'WARNING')]
        if report['telemetry']['browser_errors']:
            add_issue(report, 'major', '前端真实渲染层', 'browser console', '检测到浏览器控制台告警/错误。', '前端运行时异常。', json.dumps(report['telemetry']['browser_errors'][:3], ensure_ascii=False), '修复前端控制台错误并纳入回归测试。')

        perf_logs = []
        try:
            perf_logs = driver.get_log('performance')
        except Exception:
            perf_logs = []

        failed_requests = []
        for entry in perf_logs:
            try:
                msg = json.loads(entry['message'])['message']
                if msg.get('method') == 'Network.responseReceived':
                    response = msg.get('params', {}).get('response', {})
                    status = int(response.get('status', 0))
                    url = response.get('url', '')
                    if status >= 400:
                        failed_requests.append({'url': url, 'status': status})
            except Exception:
                continue

        report['telemetry']['failed_requests'] = failed_requests
        if failed_requests:
            add_issue(report, 'major', '前后端联动层', 'network', '浏览器捕获到失败请求。', '接口异常或路径问题。', json.dumps(failed_requests[:5], ensure_ascii=False), '检查失败请求对应接口。')

        with open(report['artifacts']['browser_console'], 'w', encoding='utf-8') as f:
            json.dump(report['telemetry']['browser_errors'], f, ensure_ascii=False, indent=2)
        with open(report['artifacts']['network_summary'], 'w', encoding='utf-8') as f:
            json.dump(report['telemetry']['failed_requests'], f, ensure_ascii=False, indent=2)

    except Exception as err:
        add_issue(report, 'critical', '浏览器诊断环境', 'selenium runtime', 'Selenium 运行失败。', '浏览器启动或操作异常。', f"{err}\n{traceback.format_exc()[:1000]}", '检查 chromedriver 与浏览器版本匹配。')
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass

    report['meta']['finished_at'] = now()
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)


if __name__ == '__main__':
    main()
