/**
 * 额外动作拓展 —— 面板。纯 ESM，无 import（Coopanion 把它当扩展的 webUiClient 注入）。
 *
 * 契约：`export default { panels: { <panelId>: { mount(ctx) } } }`，
 * mount 拿到 `{ root, invoke, pickPath, refresh, ui }`；`invoke(method, args[])` 打到
 * src/world.js 的 invoke 上。所有落盘在那边，这里只管勾选和呈现。
 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** 面板侧的选择上限，和宿主的 writer 一致。 */
const MAX_SELECTED = 300;
/** 制作人头像（96px webp 的 data URL）。嵌在面板里，不读本地文件、不发网络请求。 */
const CREDITS = [
  { name: '丹尼尔（Daniele贤狼赫萝）', role: '形象包机制与插件制作', avatar: 'data:image/webp;base64,UklGRuQEAABXRUJQVlA4INgEAADQFgCdASpgAGAAPmEskkakIqGhJlbb2IAMCWUAyBigyqTAbi3ecmzucUaAu2WW3wU1BTTBDPn0zqZIVQCKJD3BZm2dXNKTvP/EgEhmqV2I8oLIRI9kVaM6Tp4TiiK2yFf8+3liRNzvWqrgsrc4/phjMfPRUh3AzirDyhqRPo6ExNbrxUel3Kl0untfy8b7GsmW/Pq+5LetFwjcIgKMq35Z6esdWQ1XsvfREbkdUhHstqY6BE2dhUzyv5C9zjG4AAD+Cfk0jcSDwc3p0zMJQgW8wSMB2AkhBEvX/8YRbH+wP3s6g//5Z//RD/KLnu5dBUlpvOYnQR9S7VV6U1Uz6JaONNLTZyL8XVvHKvC+cKLUGUoWrd9hCyP7AFu5kmb004Zje51XdOmJIqqSXi92RV85ml/VMBMgYT2T/C/cWm83O4qSE/rWPyx7QBb0sGuyrMWnQFgdI744ta0ZPQRQ78ml5tU+4tDDvXKplrjTBtbOv4211RXTF0HHI5c0Rj5zvpDk7w/KoBLMgMBfSMRKy7+Ox841jdxuwlD1nZQ9S4bBeXA2SFBerCMaQ+7QkxLu5fMkbbAt1OeLDUUAvPJTJhlV48Pyy63r4LJ6aiNkpHY8pfBKvB+5Q8ZAj2jV7JB8KpB9PceuNBXkvWv6W63i7LDVuP40iPA2zMaXcibr+i4kEmjXvvdC6dIz3Hwwnigs5X1Q7Z6Q10KPO8wI9EnplzytJPDEKxVyaUTKOK5h0/PuadddXd8YenUrd/Cz+gmeUD7eWThye7sHGeZPoo5epkl4h3ENvvRJ1/dLN3B9/PGY6E+eFqJU0qgc4dXk+fKAGfDQfQwtc7rsICPKl3XIi5SXJFzvf1PV1lroU2AlgMpXTUOUyONShMTuBIm8Up1B5iY31yts6T1tWH2TsjScAkFvI1uFsZFZEHdVigcKd3VDvu8sODMMviw08z8bPgfFBWfnq+COMp39I53fLvURJ+K99vqsHse/NwNVrFpHtraTC56zFXk+pdNARHIXfpIx+6Uap2GTpM2boFWN/KddY1q3sFnPkZgVd9OWjdHBQd8c0lrqVvW46HZ8FlUP1Zp9gMj+5yq6TXFfeI6WxqeRY3RtyIXD5sjUZD5tgDfyrta8JRdQcYyLlRmIWKLfENjJQET4d49QrZOIXBO+zCFfrcs3dRa9AVXh+4WN8e7xVGw5IBG0afvCGfMkAn36nmJ1hge5t8H9cOy44+Mz28Hft9q7fHWq7SvX1ivTg1rimb4bKU9edzoRsTLL+6wiJ9NbVQBYWEaeuAx7QJjIR7mLaLu27F4ZSCsDxCXPEog09ZmBSYkb88FRaLdYmIrXxVOD3hVniJuQTJ4k33M+vfhse8fdO7D8+U2GVVK29MCb8YjrnFzBVFsjwQRXi/CVo8bi2DrpkD35V2w1a4144fTMt7ypeL/FMT6qo9vXOu59ZzWp72+vUotzBu6jhz8ohjkwcW9oP83x/ZOJpWrDyis3W2kgeAVkOwwzLWV+DZlnObWCQ9eWd1AOMCOCn3EIuzCiietAs7Et95LMSJresrZOIEwTkOXsujs6xZLIny+d2nLW9vxtaJQ9rJEuz63HXRD9m2mkhIfLHv/G0L50rK/6def/rQjaBq17fp9xfNg3WksFa+brpU1gAAAA' },
  { name: 'Net-ang（奶糖_Net）', role: '制作 · 素材与实现', avatar: 'data:image/webp;base64,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' },
];

const mb = (n) => (n >= 1024 * 1024 * 1024 ? `${(n / 1024 / 1024 / 1024).toFixed(2)} GB` : `${(n / 1024 / 1024).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1)} MB`);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

const CSS = `<style>
.ea{
  --ea-ink:var(--ink,#1b1a1e);--ea-soft:var(--ink-soft,#5c5c60);--ea-dim:var(--ink-dim,#8b8b8f);
  --ea-line:var(--line,#e3e4e3);--ea-line2:var(--line-2,#d0d2d0);
  --ea-bg:var(--sheet,#fbfbfb);--ea-paper:var(--paper,#f4f5f4);--ea-sheet2:var(--sheet-2,#f2f3f2);--ea-sheet3:var(--sheet-3,#e8e9e8);
  --ea-acc:var(--accent,#00a870);--ea-on:var(--on-accent,#082a1e);
  --ea-danger:var(--danger,#b45950);--ea-ok:var(--ok,#19815e);--ea-warn:var(--warn,#96743b);
  --ea-r:14px;
  color:var(--ea-ink);
  font:13px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI Variable","Segoe UI","Microsoft YaHei",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;
}
.ea *{box-sizing:border-box}
.ea button,.ea input,.ea select{font:inherit;color:inherit}
.ea b{font-weight:600}
.ea code{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:11.5px;
  background:var(--ea-sheet3);padding:1px 5px;border-radius:5px;color:var(--ea-soft)}

/* 头部 */
.ea-h{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;margin:2px 0 16px}
.ea-h h2{margin:0;font-size:17px;font-weight:650;letter-spacing:.2px;display:flex;align-items:center;gap:9px}
.ea-h h2::before{content:"";width:9px;height:9px;border-radius:50%;background:var(--ea-acc);flex:none;
  box-shadow:0 0 0 4px rgba(0,168,112,.16)}
.ea-h p{margin:7px 0 0;font-size:12px;color:var(--ea-soft);max-width:64ch;line-height:1.75}
.ea-h .tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.ea-badge{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--ea-line);border-radius:999px;
  padding:4px 10px;font-size:11.5px;color:var(--ea-soft);background:var(--ea-bg);white-space:nowrap}
.ea-badge b{color:var(--ea-ink);font-variant-numeric:tabular-nums}
.ea-badge .dot{width:6px;height:6px;border-radius:50%;background:var(--ea-acc)}

/* 工具栏 */
.ea-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 12px}
.ea-sel,.ea-inp{border:1px solid var(--ea-line);background:var(--ea-bg);color:var(--ea-ink);border-radius:10px;
  padding:8px 11px;font-size:12.5px;max-width:100%;transition:border-color .15s,box-shadow .15s}
.ea-sel{min-width:210px;flex:1 1 210px}
.ea-inp{flex:1 1 150px;min-width:130px}
.ea-inp::placeholder{color:var(--ea-dim)}
.ea-sel:focus,.ea-inp:focus{outline:none;border-color:var(--ea-acc);box-shadow:0 0 0 3px rgba(0,168,112,.14)}
.ea-lib{font-size:11.5px;color:var(--ea-dim);white-space:nowrap}

/* 按钮 */
.ea-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--ea-line);background:var(--ea-bg);
  color:var(--ea-ink);border-radius:10px;padding:7px 12px;font-size:12.5px;cursor:pointer;white-space:nowrap;
  transition:background .15s,border-color .15s,box-shadow .15s,transform .06s}
.ea-btn:hover{background:var(--ea-sheet2);border-color:var(--ea-line2)}
.ea-btn:active{transform:translateY(1px)}
.ea-btn[disabled]{opacity:.42;cursor:not-allowed;transform:none}
.ea-btn:focus-visible{outline:2px solid rgba(0,168,112,.5);outline-offset:2px}
.ea-btn.pri{background:var(--ea-acc);border-color:transparent;color:#fff;font-weight:600;
  box-shadow:0 1px 2px rgba(0,0,0,.10),0 6px 16px -10px rgba(0,168,112,.9)}
.ea-btn.pri:hover{filter:brightness(1.06);background:var(--ea-acc)}
.ea-btn.dan{color:var(--ea-danger);border-color:rgba(180,89,80,.35)}
.ea-btn.dan:hover{background:rgba(180,89,80,.08)}

/* 提示条 */
.ea-note{font-size:12px;color:var(--ea-soft);margin:0 0 12px;padding:10px 12px;border-radius:12px;
  background:var(--ea-paper);border:1px solid var(--ea-line);line-height:1.75}
.ea-note.warn{color:var(--ea-warn);background:rgba(150,116,59,.08);border-color:rgba(150,116,59,.28)}
.ea-note.bad{color:var(--ea-danger);background:rgba(180,89,80,.08);border-color:rgba(180,89,80,.28)}
.ea-note .ea-btn{padding:4px 9px;font-size:11.5px;border-radius:8px;margin-left:2px}

/* 分类芯片 */
.ea-chips{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px}
.ea-chip{border:1px solid var(--ea-line);background:var(--ea-bg);border-radius:999px;padding:5px 11px;
  font-size:12px;cursor:pointer;color:var(--ea-soft);transition:all .15s;display:inline-flex;gap:6px;align-items:center}
.ea-chip:hover{border-color:var(--ea-line2);color:var(--ea-ink)}
.ea-chip .n{font-size:10.5px;opacity:.55;font-variant-numeric:tabular-nums}
.ea-chip.on{background:var(--ea-acc);border-color:transparent;color:#fff;font-weight:600}
.ea-chip.on .n{opacity:.8}

/* 已装条 */
.ea-installed{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 12px;padding:9px 11px;
  border:1px dashed var(--ea-line2);border-radius:12px;font-size:12px;background:var(--ea-bg)}
.ea-installed .lab{color:var(--ea-dim);font-size:11.5px}
.ea-pill{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--ea-line);border-radius:999px;
  padding:3px 5px 3px 10px;background:var(--ea-sheet2);font-size:12px}
.ea-pill::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--ea-acc);flex:none}
.ea-pill button{border:0;background:transparent;color:var(--ea-dim);cursor:pointer;font-size:14px;line-height:1;
  padding:2px 5px;border-radius:50%;transition:all .15s}
.ea-pill button:hover{color:#fff;background:var(--ea-danger)}

/* 分区标题 */
.ea-sec{margin:16px 0 8px;display:flex;align-items:center;gap:8px}
.ea-sec h3{margin:0;font-size:12px;font-weight:650;letter-spacing:.4px;color:var(--ea-ink)}
.ea-sec .n{font-size:11px;color:var(--ea-dim);font-variant-numeric:tabular-nums}
.ea-sec .sp{flex:1}
.ea-sec .ea-btn{padding:4px 9px;font-size:11px;border-radius:8px;opacity:.85}

/* 卡片列表 */
.ea-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(258px,1fr));gap:9px}
.ea-row{display:flex;gap:10px;align-items:center;padding:8px 10px 8px 8px;border:1px solid var(--ea-line);
  border-radius:var(--ea-r);background:var(--ea-bg);cursor:pointer;position:relative;
  transition:border-color .15s,box-shadow .15s,transform .09s}
.ea-row:hover{border-color:var(--ea-line2);box-shadow:0 2px 12px -7px rgba(0,0,0,.4);transform:translateY(-1px)}
.ea-row.on{border-color:var(--ea-acc);box-shadow:inset 0 0 0 1px var(--ea-acc);
  background-image:linear-gradient(rgba(0,168,112,.055),rgba(0,168,112,.055))}
.ea-row.off{opacity:.5;cursor:default;transform:none;box-shadow:none}
.ea-row img,.ea-row .ea-ph{width:46px;height:46px;border-radius:10px;flex:none;object-fit:cover;
  background:var(--ea-sheet2);border:1px solid var(--ea-line)}
.ea-row .t{min-width:0;flex:1}
.ea-row .t b{display:block;font-size:12.8px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ea-row .t code{display:block;background:none;padding:0;font-size:10.5px;color:var(--ea-dim);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ea-row .tag{display:inline-block;font-size:10px;color:var(--ea-soft);border:1px solid var(--ea-line);
  border-radius:6px;padding:0 5px;margin:3px 4px 0 0;line-height:16px;background:var(--ea-paper)}
.ea-row .tag.acc{color:var(--ea-acc);border-color:rgba(0,168,112,.35);background:rgba(0,168,112,.08)}
.ea-row input{accent-color:var(--ea-acc);width:17px;height:17px;flex:none}
.ea-x{border:1px solid var(--ea-line);background:var(--ea-bg);color:var(--ea-dim);border-radius:8px;width:22px;height:22px;
  line-height:1;font-size:14px;cursor:pointer;flex:none;padding:0;transition:all .15s}
.ea-x:hover{color:#fff;background:var(--ea-danger);border-color:transparent}
.ea-ph{display:grid;place-items:center;font-size:17px;color:var(--ea-dim)}

/* 折叠区 */
.ea-more{margin:10px 0 0;border:1px solid var(--ea-line);border-radius:12px;background:var(--ea-bg);overflow:hidden}
.ea-more>summary{cursor:pointer;padding:9px 12px;font-size:12.5px;color:var(--ea-soft);list-style:none;
  display:flex;align-items:center;gap:7px;transition:color .15s,background .15s}
.ea-more>summary::-webkit-details-marker{display:none}
.ea-more>summary::before{content:"›";font-size:15px;line-height:1;opacity:.55;transition:transform .15s}
.ea-more[open]>summary::before{transform:rotate(90deg)}
.ea-more>summary:hover{color:var(--ea-ink);background:var(--ea-sheet2)}
.ea-more .body{padding:2px 12px 12px;font-size:12.5px;line-height:1.8;color:var(--ea-soft)}
.ea-more .body .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
.ea-credits{display:flex;gap:16px;flex-wrap:wrap;margin-top:8px}
.ea-person{display:flex;gap:10px;align-items:center;min-width:220px}
.ea-person img{width:46px;height:46px;border-radius:50%;object-fit:cover;border:1px solid var(--ea-line);
  background:var(--ea-sheet2);box-shadow:0 1px 3px rgba(0,0,0,.08)}
.ea-person b{display:block;font-size:12.8px;color:var(--ea-ink);font-weight:600}
.ea-person span{display:block;font-size:11px;color:var(--ea-dim)}

/* 底栏 */
.ea-foot{position:sticky;bottom:0;margin-top:16px;padding:12px 0 4px;display:flex;gap:10px;align-items:center;
  flex-wrap:wrap;border-top:1px solid var(--ea-line);background:linear-gradient(to top,var(--ea-bg) 72%,transparent)}
.ea-foot .sum{font-size:12.5px;color:var(--ea-soft)}
.ea-foot .sum b{color:var(--ea-ink);font-size:13.5px;font-variant-numeric:tabular-nums}
.ea-foot .sp{flex:1}
.ea-foot .ea-actions{display:flex;gap:8px;flex-wrap:wrap}

/* 消息行 */
.ea-msg{font-size:12.5px;min-height:18px;color:var(--ea-dim);transition:color .15s}
.ea-msg.bad{color:var(--ea-danger)}
.ea-msg.ok{color:var(--ea-ok)}
</style>`;

const panel = {
  async mount(ctx) {
    const { root } = ctx;
    root.textContent = '';
    root.insertAdjacentHTML('afterbegin', CSS);
    const wrap = el('div', 'ea');
    root.appendChild(wrap);

    // 早先的版本把提示条 appendChild 到 document.body，切页后样式随面板一起没了，
    // 于是变成一行裸文本糊在每一页顶上。这里先把那些残留清掉，之后一律只用面板内的元素。
    for (const stale of document.querySelectorAll('.ea-toast')) stale.remove();

    /**
     * 提示一律落在面板自己身上（footer 里一行），不往 document 上挂东西：
     * 面板随时可能被卸载，宿主文档不该留下我的节点。有 ctx.ui.toast 时顺带让它弹一下，
     * 那个由宿主按面板生命周期回收。
     */
    let msgEl = null;
    const say = (text, bad = false) => {
      const line = String(text ?? '');
      if (!msgEl) {
        msgEl = el('div', 'ea-msg');
        footEl.insertBefore(msgEl, footEl.firstChild);
      }
      msgEl.textContent = line;
      msgEl.className = 'ea-msg ' + (bad ? 'bad' : 'ok');
      try { ctx.ui?.toast?.(line, bad ? 'bad' : 'ok'); } catch { /* 没有 ui 也不影响面板内的这一行 */ }
    };

    let catalog = null;
    let state = null;
    let selected = new Set();
    /** 包里此刻真有哪几段（和 selected 不同：取消勾选还没保存时，装着的仍是这几个）。 */
    let installed = new Set();
    let packId = null;
    let query = '';
    let cat = 'all';

    /* ---------- 骨架 ---------- */
    wrap.innerHTML = `
      <div class="ea-h">
        <div>
          <h2>深深与额外动作拓展</h2>
          <p>勾中的动作写进形象包的 <code>额外动作拓展/</code> 文件夹，<b>勾了什么，桌宠就只做这些</b>：
             待机轮播、点击回应、以及 bot 能说的动作词，都收在这次勾选里；没勾的动作不会自己冒出来。</p>
        </div>
        <div class="tools">
          <span class="ea-badge" data-role="badge"><span class="dot"></span>准备中</span>
          <button class="ea-btn" data-act="reload">重新加载形象</button>
        </div>
      </div>
      <div class="ea-bar">
        <select class="ea-sel" data-role="pack"></select>
        <input class="ea-inp" data-role="q" placeholder="搜名字 / id…">
        <button class="ea-btn" data-act="library">选择动作库…</button>
        <span class="ea-lib" data-role="lib"></span>
      </div>
      <div class="ea-note" data-role="note" hidden></div>
      <div class="ea-installed" data-role="installed" hidden></div>
      <div class="ea-chips" data-role="chips"></div>
      <div data-role="list"></div>
      <details class="ea-more" data-role="more">
        <summary>添加更多动作…</summary>
        <div class="body">
          选一个文件夹：里面是一整套 <code>f_0001.webp</code>、<code>f_0002.webp</code>… （同尺寸），
          或者一个装着若干这种文件夹的父目录。收进动作库之后，它们会像自带动作一样出现在上面的列表里，可以勾选。
          <div class="row">
            <button class="ea-btn pri" type="button" data-act="add">选择动作文件夹…</button>
            <span data-role="addmsg"></span>
          </div>
          <div style="margin-top:6px">可选：同目录放 <code>action.json</code> 指定 <code>{"id":"eat-burger","zh":"吃汉堡","category":"extra","fps":24}</code>；不给就按目录名自动生成、24 fps。</div>
        </div>
      </details>
      <details class="ea-more" data-role="credits" open>
        <summary>制作</summary>
        <div class="body">
          <div class="ea-credits">${CREDITS.map((c) => `<div class="ea-person"><img src="${c.avatar}" alt=""><div><b>${esc(c.name)}</b><span>${esc(c.role)}</span></div></div>`).join('')}</div>
          <div style="margin-top:8px">动作素材：MerZlin/dsh-pet-indesktop（assets-v1）· 形象包代码与封装：DSH-PET 工作区 · 插件：Cortico World（api 6）</div>
        </div>
      </details>
      <div class="ea-foot">
        <span class="sum" data-role="sum"></span>
        <span class="sp"></span>
        <div class="ea-actions">
          <button class="ea-btn" data-act="none">清空勾选</button>
          <button class="ea-btn" data-act="all">全选可点名</button>
          <button class="ea-btn" data-act="prune" title="删掉包里用不到的动作模块">压缩包</button>
          <button class="ea-btn dan" data-act="clear">清空拓展</button>
          <button class="ea-btn pri" data-act="save">保存到形象包</button>
        </div>
      </div>`;

    /* 模板自检：少一个节点就当场炸，别留成静默 null */
    const REQUIRED = [
      '[data-role=pack]', '[data-role=q]', '[data-role=lib]', '[data-role=note]',
      '[data-role=installed]', '[data-role=chips]', '[data-role=list]', '[data-role=sum]',
      '.ea-foot', '[data-act=save]', '[data-act=clear]', '[data-act=add]', '[data-act=prune]', '[data-act=library]',
    ];
    const missing = REQUIRED.filter((sel) => !wrap.querySelector(sel));
    if (missing.length) throw new Error('面板模板缺少节点：' + missing.join(', '));

    const $ = (sel) => wrap.querySelector(sel);
    const packSel = $('[data-role=pack]');
    const qInp = $('[data-role=q]');
    const noteEl = $('[data-role=note]');
    const chipsEl = $('[data-role=chips]');
    const installedEl = $('[data-role=installed]');
    const listEl = $('[data-role=list]');
    const sumEl = $('[data-role=sum]');
    const libEl = $('[data-role=lib]');
    const footEl = wrap.querySelector('.ea-foot');

    const pack = () => state?.figures?.find((f) => f.id === packId) ?? null;
    const wordCount = () => (catalog?.actions ?? []).filter((a) => a.word).length;
    const bytesOf = (ids) => {
      const set = new Set(ids);
      return (catalog?.actions ?? []).filter((a) => set.has(a.id)).reduce((n, a) => n + (a.bytes || 0), 0);
    };

    function renderPack() {
      const list = (state?.figures ?? []).filter((f) => f.supported && !f.builtin);
      packSel.innerHTML = '';
      if (!list.length) {
        packSel.appendChild(el('option', null, '没有可写的形象包'));
        packSel.disabled = true;
        return;
      }
      packSel.disabled = false;
      for (const f of list) {
        const o = el('option');
        o.value = f.id;
        o.textContent = `${f.name}${f.current ? '（正在用）' : ''} · ${f.id}`;
        packSel.appendChild(o);
      }
      if (!list.some((f) => f.id === packId)) packId = list[0].id;
      packSel.value = packId;
    }

    function renderChips() {
      const byCat = new Map();
      for (const a of catalog?.actions ?? []) {
        if (!byCat.has(a.category)) byCat.set(a.category, { id: a.category, zh: a.catZh || a.category, count: 0 });
        byCat.get(a.category).count++;
      }
      const cats = [...byCat.values()];
      const total = { id: 'all', zh: '全部', count: (catalog?.actions ?? []).length };
      chipsEl.innerHTML = '';
      for (const c of [total, ...cats]) {
        const b = el('button', 'ea-chip' + (cat === c.id ? ' on' : ''), `${esc(c.zh)} <span style="opacity:.7">${c.count}</span>`);
        b.type = 'button';
        b.onclick = () => { cat = c.id; renderChips(); renderList(); };
        chipsEl.appendChild(b);
      }
    }

    function rowOf(a) {
      const isState = !a.word;
      const on = selected.has(a.id);
      const mounted = installed.has(a.id);
      const row = el('div', 'ea-row' + (on ? ' on' : '') + (isState ? ' off' : ''));
      row.innerHTML = `
        ${a.thumb ? `<img src="${esc(a.thumb)}" alt="" loading="lazy">` : `<span class="ea-ph">${esc((a.zh || "?").slice(0, 1))}</span>`}
        <div class="t">
          <b>${esc(a.zh)}</b>
          <code>${esc(a.id)}</code>
          <div>
            <span class="tag">${esc(a.catZh)}</span>
            <span class="tag">${a.seconds.toFixed(1)}s</span>
            ${mounted ? '<span class="tag acc">已装</span>' : ''}
            ${isState ? '<span class="tag">状态 · 不用勾</span>' : ''}
            ${a.reaction ? '<span class="tag">点击</span>' : ''}
            ${a.noMirror ? '<span class="tag">带字</span>' : ''}
            ${a.random ? '' : '<span class="tag">不轮播</span>'}
          </div>
        </div>
        ${mounted ? '<button class="ea-x" type="button" title="从包里删掉这一段" aria-label="删除">×</button>' : ''}
        <input type="checkbox" ${on ? 'checked' : ''} ${isState ? 'disabled' : ''}>`;
      if (!isState) {
        const box = row.querySelector('input');
        row.onclick = (e) => {
          if (e.target.closest('.ea-x')) return;      // × 交给它自己的处理
          if (e.target !== box) box.checked = !box.checked;
          if (box.checked) selected.add(a.id); else selected.delete(a.id);
          row.classList.toggle('on', box.checked);
          renderSum();
        };
      }
      return row;
    }

    /** 已装的一段一段列出来，每段带一个 × —— 这就是"删除单个动作拓展"。 */
    function renderInstalled() {
      const ids = [...installed];
      installedEl.hidden = ids.length === 0;
      if (!ids.length) { installedEl.innerHTML = ''; return; }
      installedEl.innerHTML = `<span class="lab">包里已装 ${ids.length} 段：</span>`;
      for (const id of ids) {
        const a = catalog?.actions.find((x) => x.id === id);
        const pill = el('span', 'ea-pill', `${esc(a?.zh ?? id)}<button type="button" data-act="remove" data-id="${esc(id)}" title="删掉这一段">×</button>`);
        installedEl.appendChild(pill);
      }
      const hint = el('span', 'lab', '（× 直接删掉这一段；要改就重新勾选后保存）');
      installedEl.appendChild(hint);
    }

    function renderList() {
      const acts = (catalog?.actions ?? []).filter((a) => {
        if (cat !== 'all' && a.category !== cat) return false;
        if (!query) return true;
        const q = query.toLowerCase();
        return a.id.toLowerCase().includes(q) || a.zh.includes(query) || (a.say || '').includes(query);
      });
      listEl.innerHTML = '';
      if (!acts.length) {
        listEl.appendChild(el('div', 'ea-note', '没有匹配的动作。'));
        return;
      }
      const groups = new Map();
      for (const a of acts) {
        if (!groups.has(a.category)) groups.set(a.category, []);
        groups.get(a.category).push(a);
      }
      for (const [cid, rows] of groups) {
        const sec = el('div', 'ea-sec');
        const picked = rows.filter((a) => selected.has(a.id)).length;
        sec.innerHTML = `<h3>${esc(rows[0].catZh)}</h3>
          <span class="n">${picked}/${rows.filter((a) => a.word).length} 已选</span><span class="sp"></span>`;
        const all = el('button', 'ea-btn', '选这一类');
        all.type = 'button';
        all.onclick = () => {
          for (const a of rows) if (a.word) selected.add(a.id);
          renderList(); renderSum();
        };
        const none = el('button', 'ea-btn', '清这一类');
        none.type = 'button';
        none.onclick = () => {
          for (const a of rows) selected.delete(a.id);
          renderList(); renderSum();
        };
        sec.append(all, none);
        listEl.appendChild(sec);
        const grid = el('div', 'ea-list');
        for (const a of rows) grid.appendChild(rowOf(a));
        listEl.appendChild(grid);
      }
    }

    function renderSum() {
      const n = selected.size;
      const saveBtn = wrap.querySelector('[data-act=save]');
      if (saveBtn) saveBtn.disabled = n === 0;
      const badge = wrap.querySelector('[data-role=badge]');
      if (badge) badge.innerHTML = `<span class="dot"></span><b>${n}</b> 已选 · ${installed.size} 已装`;
      const p = pack();
      const extra = p?.extra?.count ?? 0;
      sumEl.innerHTML = `已勾选 <b>${n}</b> 段 · 约 <b>${mb(bytesOf(selected))}</b>` +
        (extra ? `　包里已有 ${extra} 段（${mb(p.extra.bytes || 0)}）` : '');
    }

    function renderNote() {
      const p = pack();
      noteEl.hidden = true;
      noteEl.className = 'ea-note';
      if (!state) return;
      if (!state.library.ok) {
        noteEl.hidden = false;
        noteEl.className = 'ea-note bad';
        noteEl.innerHTML = `动作库目录没找到：<code>${esc(state.library.dir || '未设置')}</code> —— 点「选择动作库…」指向 <code>深深-动作库</code> 那个文件夹。`;
        return;
      }
      if (!p) {
        noteEl.hidden = false;
        noteEl.className = 'ea-note warn';
        noteEl.innerHTML = '没有可写的形象包。先把「深深 · 动作库」（或打了补丁的深深）装进 Coopanion。';
        return;
      }
      noteEl.hidden = false;
      if (!/^shenshen/.test(p.id)) {
        noteEl.className = 'ea-note warn';
        noteEl.innerHTML = `这些帧画的是<b>深深</b>。包 <code>${esc(p.id)}</code> 不是深深系的，加进去会穿帮 —— 请选 <code>shenshen-actions</code>。`;
        return;
      }
      // 桌宠用的不是这个包：词表跟着形象走，不切过去它当然"没有这个词"
      const cur = state.figures?.find((f) => f.id === state.current) ?? null;
      const offPet = !!state.current && state.current !== packId;
      noteEl.className = 'ea-note' + (offPet ? ' warn' : '');
      noteEl.innerHTML = (offPet
        ? `桌宠现在用的是 <b>${esc(cur?.name ?? state.current)}</b>，词表跟着形象走 —— 不切过去它就会说“没有这个词”。`
          + `<br><span class="ea-dim">勾选保存后，去 Coopanion 的<b>装扮页</b>重新点一下这个形象，它才会加载新的动作表。</span><br>`
        : '')
        + `写入 <code>${esc(p.dir)}\\额外动作拓展\\</code>　·　动作库 <code>${esc(state.library.dir)}</code>（${state.library.count} 段）`
        + `<br>保存会把 <code>figure.json</code> 的动作词裁成你勾的这些（表情不动），原文备份在 <code>figure.json.bak-额外动作拓展</code>；「清空拓展」可完整还原。`;
    }

    /* ---------- 数据 ---------- */
    /** 目录清单是构建产物，但面板拿到的每一份都不可信：只留结构对得上的条目。 */
    function trustedCatalog(raw) {
      const idOk = (v) => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,31}$/.test(v);
      const actions = (Array.isArray(raw?.actions) ? raw.actions : []).filter((a) => a
        && idOk(a.id)
        && (a.word == null || idOk(a.word))
        && typeof a.category === 'string' && /^[a-z][a-z0-9-]{0,15}$/.test(a.category)
        && typeof a.clip === 'string' && a.clip.startsWith('actions/')
        && Number.isInteger(a.frames) && a.frames > 0 && a.frames <= 1000
        && typeof a.seconds === 'number' && Number.isFinite(a.seconds) && a.seconds > 0 && a.seconds <= 60
        && (a.thumb == null || /^data:image\/(webp|png);base64,[A-Za-z0-9+/=]+$/.test(a.thumb)));
      return { ...raw, actions, count: actions.length, words: actions.filter((a) => a.word).length };
    }

    async function loadAll() {
      catalog = trustedCatalog(await ctx.invoke('catalog'));
      state = await ctx.invoke('state');
      packId = state.pick || state.current || state.figures?.find((f) => f.supported)?.id || null;
      const p = state.figures?.find((f) => f.id === packId);
      installed = new Set(p?.extra?.ids ?? []);
      selected = new Set([...installed].filter((id) => catalog.actions.some((a) => a.id === id && a.word)).slice(0, MAX_SELECTED));
      libEl.textContent = state.library.ok
        ? `${state.library.count} 段可用` + (state.library.imported ? `（自定义 ${state.library.imported}）` : '')
        : '动作库未设置';
      renderPack(); renderChips(); renderList(); renderInstalled(); renderSum(); renderNote();
    }

    function loadSelectionFor(id) {
      const p = state?.figures?.find((f) => f.id === id);
      installed = new Set(p?.extra?.ids ?? []);
      selected = new Set([...installed].filter((x) => catalog.actions.some((a) => a.id === x && a.word)).slice(0, MAX_SELECTED));
    }

    /* ---------- 交互 ---------- */
    packSel.onchange = () => {
      packId = packSel.value;
      loadSelectionFor(packId);
      renderList(); renderInstalled(); renderSum(); renderNote();
    };
    qInp.oninput = () => { query = qInp.value.trim(); renderList(); };

    wrap.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      const busy = (on) => { for (const b of wrap.querySelectorAll('button')) b.disabled = on; };
      try {
        if (act === 'all') {
          for (const a of catalog.actions) if (a.word) selected.add(a.id);
          renderList(); renderSum();
        } else if (act === 'none') {
          selected.clear(); renderList(); renderSum();
        } else if (act === 'save') {
          if (!packId) return say('先选一个形象包', true);
          if (!selected.size) {
            // 一段都没勾 = 不想让它做任何额外动作，等同清空，别丢一个看不懂的报错
            if (!confirm('一段都没勾 —— 等于清空这个包的额外动作（词表还原成原样）。继续？')) return;
            busy(true);
            const rc = await ctx.invoke('clear', [packId]);
            installed.clear();
            state = await ctx.invoke('state');
            say(rc.vocab?.restored ? '已清空，figure.json 的词表已还原' : '已清空');
            renderPack(); packSel.value = packId; renderList(); renderInstalled(); renderSum(); renderNote();
            return;
          }
          busy(true); say(`正在写入 ${selected.size} 段…`);
          const r = await ctx.invoke('save', [packId, [...selected]]);
          state = await ctx.invoke('state');
          const p = state.figures?.find((f) => f.id === packId);
          selected = new Set(r.copied.concat(r.skipped).filter((id) => catalog.actions.some((a) => a.id === id)));
          say(`已写入 ${r.count} 段，${mb(r.bytes)}；词表 +${r.vocab.added.length} −${r.vocab.removed.length}${r.reloaded ? '，桌宠已重新加载' : ''}`);
          libEl.textContent = state.library.ok ? `${state.library.count} 段可用` : '动作库未设置';
          renderPack(); packSel.value = packId; renderList(); renderInstalled(); renderSum(); renderNote();
          if (p) p.extra = { ids: [...selected], count: r.count, bytes: r.bytes, updatedAt: r.updatedAt };
        } else if (act === 'prune') {
          if (!packId) return say('先选一个形象包', true);
          if (!confirm('把包里用不到的动作模块删掉，只保留身体状态和已勾选的？\n\n之后想再用某一段，勾上再保存就会从动作库重新拷进来。')) return;
          busy(true); say('正在压缩…');
          const r = await ctx.invoke('prune', [packId]);
          state = await ctx.invoke('state');
          say(`已压缩：删掉 ${r.removed.length} 个模块，省出 ${mb(r.freed)}`);
          renderPack(); packSel.value = packId; renderList(); renderInstalled(); renderSum(); renderNote();
        } else if (act === 'clear') {
          if (!packId) return say('先选一个形象包', true);
          if (!confirm('清空这个形象包里的「额外动作拓展」？figure.json 里加过的词也会撤掉。')) return;
          busy(true);
          const r = await ctx.invoke('clear', [packId]);
          selected.clear();
          state = await ctx.invoke('state');
          say(r.vocab?.restored ? "已清空，figure.json 的词表已还原" : `已清空（撤掉 ${r.vocab?.removed?.length ?? 0} 个词）`);
          renderPack(); packSel.value = packId; renderList(); renderInstalled(); renderSum(); renderNote();
        } else if (act === 'remove') {
          const id = btn.dataset.id;
          if (!id) return;
          const a = catalog.actions.find((x) => x.id === id);
          if (!confirm(`从包里删掉「${a?.zh ?? id}」这一段？其余动作保持不动，词表会同步。`)) return;
          busy(true);
          const r = await ctx.invoke('remove', [packId, id]);
          installed.delete(id); selected.delete(id);
          state = await ctx.invoke('state');
          const p2 = state.figures?.find((f) => f.id === packId);
          if (p2) p2.extra = { ...(p2.extra ?? {}), ids: [...installed], count: installed.size };
          say(r.cleared
            ? `已删除「${a?.zh ?? id}」，包里没有额外动作了，词表已还原`
            : `已删除「${a?.zh ?? id}」，还剩 ${r.remaining} 段`);
          renderPack(); packSel.value = packId; renderList(); renderInstalled(); renderSum(); renderNote();
        } else if (act === 'add') {
          let dir = null;
          try {
            dir = await ctx.pickPath({ kind: 'directory', title: '选择动作文件夹（里面有 f_0001.webp…）' });
          } catch { dir = null; }
          if (!dir) return say('没有选目录', true);
          busy(true); say('正在收进动作库…');
          const r = await ctx.invoke('add', [dir]);
          const nb = r.added.length, ns = r.skipped.length;
          say(nb
            ? `已加入 ${nb} 个动作${ns ? `，跳过 ${ns} 个` : ''}`
            : `没有可加入的动作（${r.skipped[0]?.reason ?? '格式不符'}）`, !nb);
          if (nb) await loadAll();
          const addMsg = wrap.querySelector('[data-role=addmsg]');
          if (addMsg) {
            addMsg.textContent = nb
              ? r.added.map((x) => `${x.zh}（${x.frames} 帧 / ${x.seconds}s）`).join('、')
              : (r.skipped.map((x) => `${x.dir}：${x.reason}`).join('；') || '');
          }
        } else if (act === 'reload') {
          if (!packId) return;
          busy(true);
          await ctx.invoke('reload', [packId]);
          say('桌宠已重新加载形象');
        } else if (act === 'library') {
          // 协议里 PathPickerOptions.kind 只有 'file' | 'directory'
          const dir = await ctx.pickPath({ kind: 'directory', title: '选择动作库目录（里面要有 actions/）' });
          if (!dir) return say('没有选目录', true);
          busy(true);
          await ctx.invoke('set-library', [dir]);
          await loadAll();
          say('动作库已更新');
        }
      } catch (err) {
        say(String(err?.message ?? err), true);
      } finally {
        busy(false);
      }
    });

    try {
      await loadAll();
    } catch (err) {
      wrap.innerHTML = `<div class="ea-note bad">加载失败：${esc(err?.message ?? err)}</div>`;
    }
  },
};

export default { panels: { picker: panel } };
