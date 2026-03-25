#!/usr/bin/env python3
import argparse
import json
import os
import re
import traceback
from datetime import datetime

ERROR_PATTERNS = ['接口不存在', '评分失败', '获取失败', '加载失败', 'undefined', 'null', 'NaN']
PLACEHOLDER_PATTERNS = ['暂无数据', 'loading', '加载中', 'skeleton']
MODULES = [
    {'name': '真实高分新股 TOP3', 'selector': '#top3', 'key': 'top3'},
    {'name': '当前新股评分榜', 'selector': '#leaderboard', 'key': 'leaderboard'},
    {'name': '新股时间表', 'selector': '#timeline', 'key': 'timeline'},
    {'name': '市场温度', 'selector': '#market', 'key': 'market'},
    {'name': '模型验证摘要', 'selector': '#validation', 'key': 'validation'},
]


def now():
    return datetime.utcnow().isoformat() + 'Z'


def write_json(path, payload):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


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


def js_text_of(driver, selector):
    script = """
const el = document.querySelector(arguments[0]);
return el ? (el.innerText || el.textContent || '').trim() : '';
"""
    return driver.execute_script(script, selector)


def normalize_text(text):
    return re.sub(r'\s+', ' ', (text or '')).strip()


def has_real_content(text):
    t = normalize_text(text)
    if not t:
        return False, '文本为空'
    lower = t.lower()
    if t in ('暂无数据', 'N/A', '--'):
        return False, '仅展示占位文本'
    if any(p in lower for p in PLACEHOLDER_PATTERNS):
        return False, '包含占位/加载文本'
    if len(t) < 12:
        return False, '文本长度过短'
    return True, '通过基础内容检测'


def evaluate_score_result(score_text):
    normalized = normalize_text(score_text)
    checks = {
        'raw_length': len(normalized),
        'has_total_score_keyword': bool(re.search(r'总分|total\s*score|score', normalized, re.I)),
        'has_dimension_keyword': bool(re.search(r'维度|基本面|估值|风险|热度|dimension', normalized, re.I)),
        'has_explanation_keyword': bool(re.search(r'解释|说明|规则|原因|because|reason', normalized, re.I)),
        'numeric_values': re.findall(r'\d+(?:\.\d+)?', normalized),
    }
    checks['has_multi_numeric_values'] = len(checks['numeric_values']) >= 3
    return checks


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
            'selected_browser': None,
            'selenium_available': False,
            'chrome_started': False,
        },
        'checks': {
            'home_opened': False,
            'error_text_hits': [],
            'module_content': {},
            'score_chain': {},
        },
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
            'page_text_summary': os.path.join(args.artifacts, 'page-text-summary.json'),
        },
    }

    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        report['environment']['selenium_available'] = True
    except Exception as err:
        add_issue(report, 'critical', '浏览器诊断环境', 'python import selenium', 'Selenium 未安装，无法执行真实浏览器诊断。', 'Python 环境缺少 selenium 包。', str(err), '执行: python3 -m pip install selenium')
        report['meta']['finished_at'] = now()
        write_json(args.out, report)
        return

    browser_binary = None
    for candidate in report['environment']['chrome_candidates']:
        if os.path.exists(candidate):
            browser_binary = candidate
            break

    if not browser_binary:
        add_issue(report, 'critical', '浏览器诊断环境', 'browser binary', '未找到可用浏览器二进制。', '系统中不存在 google-chrome/chromium-browser。', 'checked /usr/bin/google-chrome and /usr/bin/chromium-browser', '安装 Chrome/Chromium 后重试。')
        report['meta']['finished_at'] = now()
        write_json(args.out, report)
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
        driver = webdriver.Chrome(options=options)
        report['environment']['chrome_started'] = True
        wait = WebDriverWait(driver, 25)
        report['executed'] = True

        driver.get(f"{args.url}/hk/")
        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '#scoreForm')))
        report['checks']['home_opened'] = True

        driver.save_screenshot(report['artifacts']['home_screenshot'])
        with open(report['artifacts']['page_source'], 'w', encoding='utf-8') as f:
            f.write(driver.page_source)

        module_texts = {}
        merged_parts = []
        for mod in MODULES:
            text = js_text_of(driver, mod['selector'])
            module_texts[mod['key']] = {'name': mod['name'], 'selector': mod['selector'], 'text': text, 'length': len(normalize_text(text))}
            merged_parts.append(text or '')
            ok, reason = has_real_content(text)
            module_texts[mod['key']]['real_content_ok'] = ok
            module_texts[mod['key']]['judge_reason'] = reason
            if not ok:
                level = 'critical' if mod['key'] in ('top3', 'leaderboard') else 'major'
                add_issue(
                    report,
                    level,
                    '数据完整度',
                    mod['selector'],
                    f"{mod['name']} 模块疑似空壳/假渲染。",
                    '模块容器存在但未展示真实业务内容。',
                    f"len={module_texts[mod['key']]['length']}, text={normalize_text(text)[:180]}",
                    '检查 dashboard 数据聚合、字段映射与渲染分支。',
                )

        page_text = normalize_text('\n'.join(merged_parts + [js_text_of(driver, 'body')]))
        for pattern in ERROR_PATTERNS:
            if pattern.lower() in page_text.lower():
                report['checks']['error_text_hits'].append(pattern)
                add_issue(report, 'critical', '前端真实渲染层', '/hk/ page text', f'页面出现明显错误文案: {pattern}', '前端接口失败或渲染异常。', pattern, '检查失败请求、字段映射与异常分支。')

        report['checks']['module_content'] = module_texts

        code_input = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '#codeInput')))
        submit_btn = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, '#scoreForm button[type="submit"]')))
        code_input.clear()
        code_input.send_keys(args.code)
        submit_btn.click()

        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '#scoreResult')))
        wait.until(lambda d: len(normalize_text(js_text_of(d, '#scoreResult'))) > 0)
        score_text = js_text_of(driver, '#scoreResult')
        score_checks = evaluate_score_result(score_text)
        report['checks']['score_chain'] = {
            'input_code': args.code,
            'score_result_text': score_text,
            **score_checks,
        }
        driver.save_screenshot(report['artifacts']['score_screenshot'])

        if not score_checks['raw_length']:
            add_issue(report, 'critical', '核心评分链路', '#scoreResult', '点击评分后无结果。', '评分接口或渲染链路失败。', '<empty>', '检查提交事件、接口响应、前端渲染函数。')
        else:
            for pattern in ['评分失败', '接口不存在', '获取失败', '加载失败']:
                if pattern in score_text:
                    add_issue(report, 'critical', '核心评分链路', '#scoreResult', f'评分链路出现错误文案: {pattern}', '评分 API 异常或前端错误分支触发。', normalize_text(score_text)[:280], '检查 /api/score/:code 返回结构和前端解析逻辑。')
                    break
            if not score_checks['has_total_score_keyword']:
                add_issue(report, 'major', '核心评分链路', '#scoreResult', '结果中未识别到总分信息。', '渲染结果缺失核心指标或字段名变化。', normalize_text(score_text)[:280], '确认结果中总分字段与前端展示关键字。')
            if not score_checks['has_dimension_keyword']:
                add_issue(report, 'major', '核心评分链路', '#scoreResult', '结果中未识别到维度分数信息。', '维度评分未渲染或输出格式异常。', normalize_text(score_text)[:280], '补充各维度分数展示并校验字段映射。')
            if not score_checks['has_explanation_keyword']:
                add_issue(report, 'major', '核心评分链路', '#scoreResult', '结果中未识别到解释/规则说明。', '解释文案未输出。', normalize_text(score_text)[:280], '输出至少部分解释文案或规则说明供人工判读。')
            if not score_checks['has_multi_numeric_values']:
                add_issue(report, 'major', '核心评分链路', '#scoreResult', '结果中的数值信息不足。', '仅返回状态提示而非有效评分结果。', normalize_text(score_text)[:280], '检查后端返回是否为真实评分对象。')

        browser_logs = []
        try:
            browser_logs = driver.get_log('browser')
        except Exception:
            browser_logs = []
        report['telemetry']['browser_errors'] = [x for x in browser_logs if x.get('level') in ('SEVERE', 'WARNING')]
        if report['telemetry']['browser_errors']:
            add_issue(report, 'major', '前端真实渲染层', 'browser console', '检测到 console warning/error。', '前端运行时异常或资源异常。', json.dumps(report['telemetry']['browser_errors'][:5], ensure_ascii=False), '按堆栈排查前端异常并补充回归用例。')

        perf_logs = []
        try:
            perf_logs = driver.get_log('performance')
        except Exception:
            perf_logs = []

        failed_requests = []
        seen = set()
        for entry in perf_logs:
            try:
                msg = json.loads(entry['message']).get('message', {})
                if msg.get('method') != 'Network.responseReceived':
                    continue
                response = msg.get('params', {}).get('response', {})
                status = int(response.get('status', 0))
                url = response.get('url', '')
                if status >= 400 and url:
                    key = f"{status}::{url}"
                    if key not in seen:
                        seen.add(key)
                        failed_requests.append({'status': status, 'url': url})
            except Exception:
                continue
        report['telemetry']['failed_requests'] = failed_requests
        if failed_requests:
            add_issue(report, 'major', '前后端联动层', 'network', '浏览器抓到失败请求。', '接口失败、路径错误或静态资源问题。', json.dumps(failed_requests[:6], ensure_ascii=False), '逐条排查失败请求与对应模块。')

        page_text_summary = {
            'error_text_hits': report['checks']['error_text_hits'],
            'module_content': report['checks']['module_content'],
            'score_chain_excerpt': {
                'input_code': args.code,
                'score_result_preview': normalize_text(report['checks']['score_chain'].get('score_result_text', ''))[:500],
            },
        }

        write_json(report['artifacts']['browser_console'], report['telemetry']['browser_errors'])
        write_json(report['artifacts']['network_summary'], report['telemetry']['failed_requests'])
        write_json(report['artifacts']['page_text_summary'], page_text_summary)

    except Exception as err:
        add_issue(report, 'critical', '浏览器诊断环境', 'selenium runtime', 'Selenium 运行失败。', '浏览器启动或自动化交互异常。', f"{err}\n{traceback.format_exc()[:1200]}", '确认 Chrome 与 chromedriver 兼容，并复核页面选择器。')
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass

    report['meta']['finished_at'] = now()
    write_json(args.out, report)


if __name__ == '__main__':
    main()
