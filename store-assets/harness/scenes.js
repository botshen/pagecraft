/* PageCraft store screenshot compositions. ?scene=1..5&lang=zh|en */
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  const SCENE = Number(q.get('scene') || 1);
  const LANG = q.get('lang') === 'en' ? 'en' : 'zh';
  const zh = LANG === 'zh';
  const L = (a, b) => (zh ? a : b);
  document.documentElement.lang = zh ? 'zh-CN' : 'en';

  const stage = document.getElementById('stage');
  const expected = new Set();
  window.__errors = [];

  window.addEventListener('message', (e) => {
    if (!e.data || !e.data.pcReady) return;
    if (e.data.error) window.__errors.push(e.data.id + ': ' + e.data.error);
    expected.delete(e.data.id);
    maybeReady();
  });

  function maybeReady() {
    if (expected.size === 0) {
      (document.fonts ? document.fonts.ready : Promise.resolve()).then(() =>
        setTimeout(() => { window.__ready = true; }, 200),
      );
    }
  }

  function panelSrc(mock, extra) {
    const id = mock + '-' + Math.random().toString(36).slice(2, 7);
    expected.add(id);
    const p = new URLSearchParams(Object.assign({ mock, lang: LANG, theme: 'light', fid: id }, extra || {}));
    return '/panel.html?' + p.toString();
  }

  const lockSvg =
    '<svg class="lock" viewBox="0 0 16 16" fill="currentColor"><path d="M4 7V5a4 4 0 1 1 8 0v2h.5A1.5 1.5 0 0 1 14 8.5v5A1.5 1.5 0 0 1 12.5 15h-9A1.5 1.5 0 0 1 2 13.5v-5A1.5 1.5 0 0 1 3.5 7H4Zm1.5 0h5V5a2.5 2.5 0 0 0-5 0v2Z"/></svg>';

  function captionHtml(c) {
    return `
      <div class="caption">
        <div>
          <h1>${c.title}</h1>
          <p>${c.sub}</p>
        </div>
        <div class="brand"><img src="/icon/128.png" alt=""><span>PageCraft</span></div>
      </div>`;
  }

  function windowHtml(url, pageHtml, panelMock, panelExtra) {
    const u = new URL(url);
    return `
      <div class="window">
        <div class="toolbar">
          <div class="dots"><i></i><i></i><i></i></div>
          <div class="navs"><span>‹</span><span>›</span><span>↻</span></div>
          <div class="omni">${lockSvg}<span><span class="host">${u.host}</span><span class="path">${u.pathname}${u.search}</span></span></div>
          <div class="tb-icons"><div class="tb-ext"><img src="/icon/128.png" alt=""><span>PageCraft</span></div></div>
        </div>
        <div class="content">
          <div class="page">${pageHtml}</div>
          <div class="panel"><iframe src="${panelSrc(panelMock, panelExtra)}"></iframe></div>
        </div>
      </div>`;
  }

  // ─── Mock pages ──────────────────────────────────────────────────────────

  const AV = ['#f6c38b', '#9cc4f5', '#b8e0b5', '#e6b3d6', '#f2d27a'];

  function qaPage(opts) {
    const clean = opts && opts.clean;
    const answers = zh
      ? [
          {
            n: '林间读书人', d: '后端工程师 · 写过 3 本技术书', v: '2.4 万人赞同了该回答',
            p: [
              '<b>先读目录和结论，再决定精读哪一章。</b>大部分技术文档 80% 的价值集中在 20% 的章节里，先用 10 分钟扫一遍目录、示例和 FAQ，标出和手头任务直接相关的部分。',
              '第二步是<b>边读边动手</b>：每读完一个小节就在本地跑一遍示例，改一个参数看看结果，比单纯读三遍记得牢得多。',
              '最后，给自己写一页「速查卡」，只记录你踩过的坑和最常用的 API，下次直接翻卡片。',
            ],
          },
          {
            n: '阿月', d: '前端 / 开源爱好者', v: '8,912 人赞同了该回答',
            p: ['我的习惯是把文档当成「地图」而不是「小说」。遇到问题时带着问题去查，比从头读到尾效率高很多。另外，一个干净、没有干扰的阅读界面真的很重要。'],
          },
        ]
      : [
          {
            n: 'Maya Chen', d: 'Backend engineer · wrote 3 tech books', v: '24K upvotes',
            p: [
              '<b>Skim the table of contents and the conclusions first, then decide what to read deeply.</b> Most docs put 80% of the value into 20% of the pages — spend ten minutes mapping examples and the FAQ before diving in.',
              'Second, <b>read with your hands</b>: run every example locally and tweak one parameter. You will remember far more than reading it three times.',
              'Finally, keep a one-page cheat sheet with only the pitfalls you hit and the APIs you use most.',
            ],
          },
          {
            n: 'Leo Park', d: 'Frontend · open-source enthusiast', v: '8,912 upvotes',
            p: ['I treat documentation as a map, not a novel. Show up with a question and search for the answer. Also: a clean reading view with zero distractions helps more than you would think.'],
          },
        ];

    const ans = answers
      .map(
        (a, i) => `
        <div class="card ans">
          <div class="ans-author"><div class="av" style="background:${AV[i]}"></div><div><b>${a.n}</b><small>${a.d}</small></div></div>
          <div class="ans-vote">${a.v}</div>
          ${a.p.map((t) => `<p>${t}</p>`).join('')}
          <div class="ans-actions"><span class="up">▲ ${L('赞同', 'Upvote')} ${i ? '8912' : '2.4' + L('万', 'K')}</span><span>▼</span><span>💬 ${i ? 214 : 1306} ${L('条评论', 'comments')}</span><span>${L('分享', 'Share')}</span><span>${L('收藏', 'Save')}</span></div>
        </div>`,
      )
      .join('');

    const side = clean
      ? ''
      : `
        <div class="qa-side Question-sideColumn" id="qa-side">
          <div class="card side-card">
            <h4>${L('相关问题', 'Related questions')}<span>${L('换一换', 'Refresh')}</span></h4>
            <ul>
              <li>${L('有哪些让你相见恨晚的学习方法？', 'What study habits do you wish you had learned earlier?')}<small>${L('1,204 个回答', '1,204 answers')}</small></li>
              <li>${L('程序员如何系统地学习一门新框架？', 'How do engineers learn a new framework systematically?')}<small>${L('836 个回答', '836 answers')}</small></li>
              <li>${L('为什么官方文档总是看不进去？', 'Why is official documentation so hard to read?')}<small>${L('512 个回答', '512 answers')}</small></li>
            </ul>
          </div>
          <div class="side-ad"><i>${L('广告', 'Ad')}</i><b>${L('年度会员 5 折', '50% off Premium')}</b><small>${L('限时开通，畅读全部专栏', 'Limited time — unlock every column')}</small></div>
          <div class="card side-card">
            <h4>${L('为你推荐', 'Recommended for you')}</h4>
            <ul>
              <li>${L('10 个提升效率的浏览器插件', '10 browser extensions that save hours')}<small>${L('热门圆桌', 'Trending')}</small></li>
              <li>${L('如何写出让人看得懂的文档', 'How to write docs people actually read')}<small>${L('编辑推荐', 'Editor\'s pick')}</small></li>
            </ul>
          </div>
        </div>`;

    return `
      <div class="qa ${clean ? 'clean' : ''}">
        <div class="qa-top">
          <div class="qa-logo">${L('知识问答', 'DevHub')}</div>
          <div class="qa-nav"><b>${L('首页', 'Home')}</b><span>${L('关注', 'Following')}</span><span>${L('热榜', 'Trending')}</span><span>${L('圆桌', 'Spaces')}</span></div>
          <div class="qa-search">${L('搜索你感兴趣的内容…', 'Search DevHub…')}</div>
          <div class="qa-ask">${L('提问', 'Ask')}</div>
        </div>
        <div class="qa-head">
          <div class="qa-tags"><span>${L('学习方法', 'Learning')}</span><span>${L('程序员', 'Engineering')}</span><span>${L('效率', 'Productivity')}</span></div>
          <div class="qa-title">${L('如何高效阅读长篇技术文档？', 'How do you read long technical docs efficiently?')}</div>
          <div class="qa-meta"><span class="qa-btn blue">${L('关注问题', 'Follow')}</span><span class="qa-btn ghost">${L('写回答', 'Answer')}</span><span>${L('3,287 个回答 · 被浏览 1,042 万次', '3,287 answers · 10.4M views')}</span></div>
        </div>
        <div class="qa-body">
          <div class="qa-main Question-mainColumn">${ans}</div>
          ${side}
        </div>
      </div>`;
  }

  function adminPage() {
    const rows = zh
      ? [
          ['SO-20261114-0381', '上海禾木文化', '¥ 12,480.00', ['ok', '已完成'], '11-14 09:42'],
          ['SO-20261114-0377', '杭州青柚科技', '¥ 3,260.00', ['ship', '运输中'], '11-14 09:15'],
          ['SO-20261113-0362', '成都山野咖啡', '¥ 860.50', ['wait', '待付款'], '11-13 21:08'],
          ['SO-20261113-0355', '深圳立方智造', '¥ 48,900.00', ['ok', '已完成'], '11-13 17:30'],
          ['SO-20261113-0349', '北京一苇书店', '¥ 1,198.00', ['bad', '已逾期'], '11-13 14:22'],
          ['SO-20261113-0341', '苏州云栖家居', '¥ 6,720.00', ['ship', '运输中'], '11-13 11:05'],
          ['SO-20261112-0336', '广州橙子传媒', '¥ 2,300.00', ['ok', '已完成'], '11-12 19:47'],
          ['SO-20261112-0328', '南京知行教育', '¥ 15,600.00', ['wait', '待付款'], '11-12 16:12'],
          ['SO-20261112-0317', '厦门海风贸易', '¥ 980.00', ['ok', '已完成'], '11-12 10:33'],
          ['SO-20261111-0309', '武汉长江物流', '¥ 7,450.00', ['ship', '运输中'], '11-11 22:18'],
          ['SO-20261111-0301', '西安古城文旅', '¥ 4,130.00', ['ok', '已完成'], '11-11 15:40'],
        ]
      : [
          ['SO-20261114-0381', 'Hemu Studio Ltd.', '$ 12,480.00', ['ok', 'Completed'], 'Nov 14 09:42'],
          ['SO-20261114-0377', 'Greenfield Tech', '$ 3,260.00', ['ship', 'Shipping'], 'Nov 14 09:15'],
          ['SO-20261113-0362', 'Mountain Coffee Co.', '$ 860.50', ['wait', 'Unpaid'], 'Nov 13 21:08'],
          ['SO-20261113-0355', 'Cubic Manufacturing', '$ 48,900.00', ['ok', 'Completed'], 'Nov 13 17:30'],
          ['SO-20261113-0349', 'Reed & Page Books', '$ 1,198.00', ['bad', 'Overdue'], 'Nov 13 14:22'],
          ['SO-20261113-0341', 'Cloudnest Home', '$ 6,720.00', ['ship', 'Shipping'], 'Nov 13 11:05'],
          ['SO-20261112-0336', 'Orange Media Group', '$ 2,300.00', ['ok', 'Completed'], 'Nov 12 19:47'],
          ['SO-20261112-0328', 'Pathway Learning', '$ 15,600.00', ['wait', 'Unpaid'], 'Nov 12 16:12'],
          ['SO-20261112-0317', 'Seabreeze Trading', '$ 980.00', ['ok', 'Completed'], 'Nov 12 10:33'],
          ['SO-20261111-0309', 'Riverline Logistics', '$ 7,450.00', ['ship', 'Shipping'], 'Nov 11 22:18'],
          ['SO-20261111-0301', 'Old Town Travel', '$ 4,130.00', ['ok', 'Completed'], 'Nov 11 15:40'],
        ];
    const tr = rows
      .map(
        (r) =>
          `<tr><td class="num">${r[0]}</td><td>${r[1]}</td><td class="amt">${r[2]}</td><td><span class="st ${r[3][0]}">${r[3][1]}</span></td><td>${r[4]}</td></tr>`,
      )
      .join('');
    return `
      <div class="adm">
        <div class="adm-nav">
          <div class="adm-brand"><i></i>${L('运营后台', 'Ops Console')}</div>
          <ul>
            <li>${L('数据概览', 'Dashboard')}</li>
            <div class="grp">${L('交易', 'SALES')}</div>
            <li class="on">${L('订单管理', 'Orders')}</li>
            <li>${L('退款售后', 'Refunds')}</li>
            <li>${L('发票管理', 'Invoices')}</li>
            <div class="grp">${L('客户', 'CUSTOMERS')}</div>
            <li>${L('客户列表', 'Accounts')}</li>
            <li>${L('跟进记录', 'Activities')}</li>
            <div class="grp">${L('系统', 'SYSTEM')}</div>
            <li>${L('权限设置', 'Permissions')}</li>
          </ul>
        </div>
        <div class="adm-main">
          <div class="adm-top">${L('交易', 'Sales')} / <b>${L('订单管理', 'Orders')}</b><div class="user"><i></i>${L('王运营', 'Alex W.')}</div></div>
          <div class="adm-body">
            <div class="adm-h"><h2>${L('订单管理', 'Orders')}</h2><span>${L('共 1,286 条', '1,286 total')}</span></div>
            <div class="adm-filter">
              <div class="fi" style="width:200px">${L('订单号 / 客户名称', 'Order # / customer')}</div>
              <span class="fbtn pri">${L('查询', 'Search')}</span><span class="fbtn def">${L('重置', 'Reset')}</span>
            </div>
            <div class="adm-tablecard" id="tablecard">
              <div class="toolbar-row toolbar">
                <span class="ttl">${L('订单列表', 'Order list')}</span>
                <span class="fbtn def">${L('批量操作 ▾', 'Bulk actions ▾')}</span>
                <span class="fbtn pri">${L('+ 新建订单', '+ New order')}</span>
                <span class="pc-export" id="pc-export">⬇ ${L('导出 CSV', 'Export CSV')}</span>
              </div>
              <table class="order-table">
                <thead><tr><th>${L('订单号', 'Order #')}</th><th>${L('客户', 'Customer')}</th><th class="amt">${L('金额', 'Amount')}</th><th>${L('状态', 'Status')}</th><th>${L('下单时间', 'Created')}</th></tr></thead>
                <tbody>${tr}</tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="dl-toast"><div class="ico">CSV</div><div>orders-2026-11-14.csv<small>${L('已下载 · 20 行 · Excel 打开不乱码', 'Downloaded · 20 rows · opens cleanly in Excel')}</small></div></div>
      </div>`;
  }

  function videoPage() {
    return `
      <div class="vid">
        <div class="vid-top">
          <div class="vid-logo">${L('视频站', 'Streamly')}</div>
          <div class="vid-nav"><span>${L('首页', 'Home')}</span><span>${L('番剧', 'Shows')}</span><span>${L('直播', 'Live')}</span><span>${L('课堂', 'Learn')}</span></div>
          <div class="vid-search">${L('CSS Grid 教程', 'CSS grid tutorial')}</div>
          <div class="vid-up">${L('投稿', 'Upload')}</div>
        </div>
        <div class="vid-body">
          <div class="vid-title">${L('30 分钟上手 CSS Grid 布局（附 3 个实战案例）', 'CSS Grid in 30 Minutes — with 3 Real Projects')}</div>
          <div class="vid-meta"><span>▶ ${L('48.2 万', '482K')}</span><span>💬 3,105</span><span>2026-11-02 20:00</span></div>
          <div class="player-wrap">
            <div class="player-code"><span class="c">/* ${L('第 2 节：区域命名', 'Part 2: named areas')} */</span>
<span class="k">.layout</span> {
  display: <span class="s">grid</span>;
  grid-template-columns: <span class="s">1fr 2fr</span>;
  grid-template-areas:
    <span class="s">"side main"</span>;
  gap: <span class="s">8px</span>;
}</div>
            <div class="player-grid"><i></i><i></i><i></i><i></i></div>
            <div class="player-bar"><div class="play"></div><span>11:24 / 30:05</span><div class="prog"></div><span>${L('1080P 高清', '1080p HD')}</span><span>${L('倍速', 'Speed')}</span></div>
          </div>
          <div class="vid-actions"><b>👍 2.1${L('万', 'K')}</b><span>🪙 8,640</span><span>⭐ 1.3${L('万', 'K')}</span><span>↗ ${L('分享', 'Share')}</span></div>
          <div class="vid-owner"><i></i><div><b>${L('前端小课堂', 'Frontend Class')}</b><small>${L('86.4 万粉丝 · 213 个视频', '864K followers · 213 videos')}</small></div><span class="follow">+ ${L('关注', 'Follow')}</span></div>
          <div class="vid-desc">${L('从零讲清 Grid 的行列、区域命名与自适应布局，最后带你做一个响应式仪表盘。', 'Rows, columns, named areas and responsive layouts from scratch — then we build a dashboard together.')}</div>
        </div>
      </div>`;
  }

  // ─── Scenes ──────────────────────────────────────────────────────────────

  const CAPTIONS = {
    1: {
      title: L('鼠标指哪改哪，<em>一句话改造任何网页</em>', 'Point at anything. <em>Change it in plain words.</em>'),
      sub: L('点选元素 → 说出需求 → AI 生成 CSS，并在当前页实时校验命中', 'Pick an element → describe the change → AI writes the CSS and verifies it on the live page'),
    },
    2: {
      title: L('没有导出按钮？<em>让 AI 给表格加一个</em>', 'No export button? <em>Have AI add one.</em>'),
      sub: L('JS 油猴脚本引擎：加按钮、导出 CSV、自动化操作 · 兼容篡改猴 / 脚本猫', 'JS userscript engine — add buttons, export CSV, automate pages · Tampermonkey & ScriptCat compatible'),
    },
    3: {
      title: L('<em>10 款一键同款改造</em>，不用写提示词', '<em>10 one-click recipes.</em> Zero prompting.'),
      sub: L('宽屏护眼阅读 · 表格导出 CSV · 解除复制限制 · 知乎 / B站 / 小红书净化 …', 'Widescreen reader · Table → CSV · Unlock copy · Soft dark mode · Code copy buttons …'),
    },
    4: {
      title: L('改完立刻见效，<em>不满意就继续微调</em>', 'See it work instantly. <em>Refine until it\u2019s right.</em>'),
      sub: L('DOM 命中实时校验与自动校准 · 规则随时开关 · 导出标准 .user.js', 'Live DOM hit check & auto-heal · toggle rules anytime · export standard .user.js'),
    },
    5: {
      title: L('<em>100% 零服务端</em>，4 种本地与自有算力任选', '<em>100% Serverless.</em> 4 local & direct AI modes.'),
      sub: L('零官方服务器、零账号、零遥测上报；支持 Chrome 内置 AI、Ollama、BYOK 与本地 MCP', 'Zero servers, zero accounts, zero telemetry — Built-in Gemini Nano, Ollama, Direct BYOK & local MCP'),
    },
  };

  const QA_URL = zh ? 'https://www.zhihu.com/question/58462217' : 'https://community.devhub.io/questions/58462217';
  const VIDEO_URL = zh ? 'https://www.bilibili.com/video/BV1xK4y1C7mP' : 'https://www.streamly.tv/watch/BV1xK4y1C7mP';

  let html = captionHtml(CAPTIONS[SCENE] || CAPTIONS[1]);

  if (SCENE === 1) {
    html += windowHtml(QA_URL, qaPage(), 'hero');
  } else if (SCENE === 2) {
    html += windowHtml('https://admin.example-erp.com/orders?status=all', adminPage(), 'table');
  } else if (SCENE === 3) {
    html += windowHtml(QA_URL, qaPage({ clean: true }), 'recipes');
  } else if (SCENE === 4) {
    html += windowHtml(VIDEO_URL, videoPage(), 'applied');
  } else if (SCENE === 5) {
    const ico = {
      eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/></svg>',
      key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M16 7l3 3M14 9l2 2"/></svg>',
      gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v9H5v-9M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>',
      shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>',
      chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 7A2 2 0 0 1 17.5 21H7V10l4.3-7.4A1.6 1.6 0 0 1 14.2 3c.6.4.9 1.2.8 2Z"/></svg>',
    };
    const items = [
      ['green', ico.eye, L('100% 纯本地零服务端', '100% client-side, zero servers'), L('不在后台读取网页，零遥测上报；发送前在本地自动完成敏感信息脱敏。', 'Zero servers or analytics. Nothing runs in the background; PII is scrubbed locally first.')],
      ['', ico.gift, L('Chrome 内置 AI 离线可用', 'Chrome Built-in Gemini Nano'), L('零配置、免密钥调用端侧模型，网页结构数据完全不出浏览器。', 'Zero-config, keyless on-device inference — page data never leaves Chrome.')],
      ['', ico.key, L('Ollama 与自带 Key 直连', 'Local Ollama & Direct BYOK'), L('支持本机 Ollama / LM Studio 免密钥离线，或直连 DeepSeek / OpenAI / Anthropic。', 'Run air-gapped with local Ollama / LM Studio, or connect your own API key directly.')],
      ['', ico.chat, L('本地 MCP 编程智能体桥接', 'Local MCP Agent Bridge'), L('通过 127.0.0.1 连接 Claude Code / Cursor / Codex，直接操控页面与规则。', 'Connect Claude Code, Cursor, or Codex over 127.0.0.1 to inspect & apply mods live.')],
      ['green', ico.shield, L('规则与密钥只存本机', 'Mods & keys stay local'), L('所有 CSS / JS 规则仅保存在浏览器本地，一键导出标准 .user.js 或 #PC1# 口令。', 'All CSS / JS rules stay in local storage and export to .user.js or #PC1# codes.')],
    ];
    html += `
      <div class="priv">
        <div class="priv-col">
          ${items
            .map(
              (it) => `<div class="priv-item"><div class="priv-ico ${it[0]}">${it[1]}</div><div><b>${it[2]}</b><span>${it[3]}</span></div></div>`,
            )
            .join('')}
        </div>
        <div class="priv-card" style="left:412px">
          <div class="inset-label"><span class="dot" style="background:#3ecf8e"></span>${L('端侧离线 · 内置 Gemini Nano + 本地 MCP', 'On-device · Built-in Nano + Local MCP')}</div>
          <iframe src="${panelSrc('settings-cloud', { state: 'settings' })}"></iframe>
        </div>
        <div class="priv-card" style="left:836px">
          <div class="inset-label"><span class="dot"></span>${L('自带 Key / 本地 Ollama · 浏览器直连无中转', 'Direct BYOK / Local Ollama · zero proxy')}</div>
          <iframe src="${panelSrc('settings-byok', { state: 'settings' })}"></iframe>
        </div>
      </div>`;
  }

  stage.innerHTML = html;

  // ─── Overlays that depend on real layout ─────────────────────────────────

  function rectIn(el, container) {
    const a = el.getBoundingClientRect();
    const b = container.getBoundingClientRect();
    return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
  }

  function addPickOverlay(target, label) {
    const page = document.querySelector('.page');
    if (!page || !target) return;
    const r = rectIn(target, page);
    const h = Math.min(r.h, page.clientHeight - r.y - 6);
    const box = document.createElement('div');
    box.className = 'pick-box';
    Object.assign(box.style, { left: r.x - 3 + 'px', top: r.y - 3 + 'px', width: r.w + 6 + 'px', height: h + 6 + 'px' });
    const tag = document.createElement('div');
    tag.className = 'pick-tag';
    tag.textContent = label;
    Object.assign(tag.style, { left: r.x - 3 + 'px', top: Math.max(6, r.y - 27) + 'px' });
    page.append(box, tag);
  }

  function addCallout(text, pos, clay) {
    const page = document.querySelector('.page');
    const c = document.createElement('div');
    c.className = 'callout';
    c.innerHTML = `<span class="dot ${clay ? 'clay' : ''}"></span>${text}`;
    Object.assign(c.style, pos);
    page.append(c);
  }

  if (SCENE === 1) {
    addPickOverlay(document.getElementById('qa-side'), 'div.Question-sideColumn');
    addCallout(L('已锁定目标：右侧推荐栏', 'Target locked: right sidebar'), { left: '24px', bottom: '22px' }, true);
  } else if (SCENE === 2) {
    const btn = document.getElementById('pc-export');
    const page = document.querySelector('.page');
    const r = rectIn(btn, page);
    addCallout(L('PageCraft 刚加上的按钮', 'Button added by PageCraft'), { left: r.x - 80 + 'px', top: r.y - 50 + 'px' });
  } else if (SCENE === 3) {
    addCallout(
      L('已启用「知乎纯净宽屏去弹窗」· 侧栏与弹窗已移除', 'Warm Widescreen Reader is on · sidebar removed'),
      { left: '50%', transform: 'translateX(-50%)', bottom: '22px' },
    );
  } else if (SCENE === 4) {
    addCallout(L('右侧推荐已隐藏 · 播放器铺满', 'Recommendations hidden · player widened'), { right: '24px', top: '64px' });
    const page = document.querySelector('.page');
    const inset = document.createElement('div');
    inset.className = 'inset';
    Object.assign(inset.style, { left: '22px', bottom: '14px' });
    inset.innerHTML = `<div class="inset-label"><span class="dot"></span>${L('我的改造 · 随时开关 / 一键导出 .user.js', 'My Mods · toggle anytime / export .user.js')}</div>
      <div class="inset-crop"><iframe style="height:540px" src="${panelSrc('mods', { state: 'mods' })}"></iframe></div>`;
    page.append(inset);
  }

  maybeReady();
})();
