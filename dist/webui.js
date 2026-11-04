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
  { name: 'Daniele贤狼赫萝（丹尼尔）', role: '形象包机制与插件制作', avatar: 'data:image/webp;base64,UklGRuQEAABXRUJQVlA4INgEAADQFgCdASpgAGAAPmEskkakIqGhJlbb2IAMCWUAyBigyqTAbi3ecmzucUaAu2WW3wU1BTTBDPn0zqZIVQCKJD3BZm2dXNKTvP/EgEhmqV2I8oLIRI9kVaM6Tp4TiiK2yFf8+3liRNzvWqrgsrc4/phjMfPRUh3AzirDyhqRPo6ExNbrxUel3Kl0untfy8b7GsmW/Pq+5LetFwjcIgKMq35Z6esdWQ1XsvfREbkdUhHstqY6BE2dhUzyv5C9zjG4AAD+Cfk0jcSDwc3p0zMJQgW8wSMB2AkhBEvX/8YRbH+wP3s6g//5Z//RD/KLnu5dBUlpvOYnQR9S7VV6U1Uz6JaONNLTZyL8XVvHKvC+cKLUGUoWrd9hCyP7AFu5kmb004Zje51XdOmJIqqSXi92RV85ml/VMBMgYT2T/C/cWm83O4qSE/rWPyx7QBb0sGuyrMWnQFgdI744ta0ZPQRQ78ml5tU+4tDDvXKplrjTBtbOv4211RXTF0HHI5c0Rj5zvpDk7w/KoBLMgMBfSMRKy7+Ox841jdxuwlD1nZQ9S4bBeXA2SFBerCMaQ+7QkxLu5fMkbbAt1OeLDUUAvPJTJhlV48Pyy63r4LJ6aiNkpHY8pfBKvB+5Q8ZAj2jV7JB8KpB9PceuNBXkvWv6W63i7LDVuP40iPA2zMaXcibr+i4kEmjXvvdC6dIz3Hwwnigs5X1Q7Z6Q10KPO8wI9EnplzytJPDEKxVyaUTKOK5h0/PuadddXd8YenUrd/Cz+gmeUD7eWThye7sHGeZPoo5epkl4h3ENvvRJ1/dLN3B9/PGY6E+eFqJU0qgc4dXk+fKAGfDQfQwtc7rsICPKl3XIi5SXJFzvf1PV1lroU2AlgMpXTUOUyONShMTuBIm8Up1B5iY31yts6T1tWH2TsjScAkFvI1uFsZFZEHdVigcKd3VDvu8sODMMviw08z8bPgfFBWfnq+COMp39I53fLvURJ+K99vqsHse/NwNVrFpHtraTC56zFXk+pdNARHIXfpIx+6Uap2GTpM2boFWN/KddY1q3sFnPkZgVd9OWjdHBQd8c0lrqVvW46HZ8FlUP1Zp9gMj+5yq6TXFfeI6WxqeRY3RtyIXD5sjUZD5tgDfyrta8JRdQcYyLlRmIWKLfENjJQET4d49QrZOIXBO+zCFfrcs3dRa9AVXh+4WN8e7xVGw5IBG0afvCGfMkAn36nmJ1hge5t8H9cOy44+Mz28Hft9q7fHWq7SvX1ivTg1rimb4bKU9edzoRsTLL+6wiJ9NbVQBYWEaeuAx7QJjIR7mLaLu27F4ZSCsDxCXPEog09ZmBSYkb88FRaLdYmIrXxVOD3hVniJuQTJ4k33M+vfhse8fdO7D8+U2GVVK29MCb8YjrnFzBVFsjwQRXi/CVo8bi2DrpkD35V2w1a4144fTMt7ypeL/FMT6qo9vXOu59ZzWp72+vUotzBu6jhz8ohjkwcW9oP83x/ZOJpWrDyis3W2kgeAVkOwwzLWV+DZlnObWCQ9eWd1AOMCOCn3EIuzCiietAs7Et95LMSJresrZOIEwTkOXsujs6xZLIny+d2nLW9vxtaJQ9rJEuz63HXRD9m2mkhIfLHv/G0L50rK/6def/rQjaBq17fp9xfNg3WksFa+brpU1gAAAA' },
  { name: '奶糖_Net（Net-ang）', role: '制作 · 素材与实现', avatar: 'data:image/webp;base64,UklGRngLAABXRUJQVlA4IGwLAACwKACdASpgAGAAPmEqkEWkIqGUC48YQAYEsoBf1CP2q8nx7F0IBOzt6Xv95u4+eM9J3+R34DejLPW3wfc/BPyUQzcT/XvqI9seNPer8gtQh1naEd6O/x1HfBXsAfrB6Z/6/wvPvX+q9gX9IeiRoEesfYQ3ZgUBeOWpYVk286N2+O6ezH+YYu0hpCs4/PBiJIIIt7fuE5t5cwPjmgSOXpfFhtqhSrZvDE+Gh/NOCY/EN81q6d/3im15uWM+A4LuSYCHqKve5bZGKvCBUTSfcDhPZFXvLCB1NZ7yWxkjEWFl089eDJJXtpwkpveZOZ8I7f8sDAuRaSWOy5V9a2lZBB3hy1bCjKSeq0GPN/cSfWWe+eEkWydXmOw2gpFCD1EpUar5loJbPbSjluboTHtjClIaUR/4FttI0IYveFFj9NHrHDUJCMwW/zfpdh4812TeAP77YQ4vN2aocQAHyFPv0aUoZSvv4zvFh4Taiptbxu3h7DyBKmwF2QEdZ0rxANVHjm+DS1UnlIjB/AwaL8PnUQ7anF6Jv35gSu1lccbX8klHPauLBfnyMyPedvMqAe0dS5OxPW1QnxZRyOJK6k5p8FfqWUrv1I4PfCqok3+7W05UHHUFljf/3HdCwGiE5smcvJW8KdwmTzkYxfN4cYLcNdYk/Kso6y6BT70K1RVufG9DeCXYSlAlkXlh4KYEXxxDNkFv5E0ajfqBk22pHQK7Rlo3SPaYsFENohprVmhMEBHX07PA3tnmsOpemF3RvsTE/bfXBDIQ8ortZhMciIMJeekY9m3l1Ld8kWhfNdrVnvXyCiUwa4WEUdeXwT8JHx8E5Qg+xQC4Ktkdy7ZSp5bYqST0Wk7d5Y3XusWi+/89SmzmaI5OJ4qYj5ahWTYmQMG2K0jYEXtJbXdMmtEod0Ztqp5Q/WlDJYy6eEGeh1IluTQ10vgmzOasa5JUseSxG15LntQQOwL3D07X+qksOLrV98R4PMVMt8tg+bmRYl8T3owErUED5dBq2/bhwf+XZbRMYBMY/DBazl2U5dgtMbAAdneHCgsPgtdfo4Aq8lsc4jYqF6Bu/kcPGfWqwc8VZx/qyd5oA+vuUf1QpVE+zQvKG13Oy4QOA6E6rsiNs4NU6OquQLwZdEFonZ3YJTafqbB10KQNNU5rxsltIP0As4qoy2XzA3B1gPqGeT2IQsvoNAb1mqE9ObYKZLHeliuju51ChmDbmCl/8SalcQRlhqc6j9ZsSblR1xQetU/X7xygSO72LCy948Wt6G0fkAjv9TKTjMmrpbaQxwb7OTZ2WetLO/kJ7vBaRbvwEs89lkqeHFo4dtpbDVjE3d7CG6ljvF6uVWT0iSdmecEpPuYBEzqN2P6TVe3vDRHaoOAPtd7uekRezFbFoJloCJY9ZJk2GGLefNBHMfEtfouWcUmEfQiFjo43Ij2oeVge0ciPdxcTIhoHlZ5XpdSmY8SYXWwIuiAG4JGxHYQy6E3JwgL/B8o85VXBJyjcGBtaX/CnmJ2QLvKgnH+qlzUGhEdbUm4FvZyLnXqbBXtfiWKT6aKkrmtKpb0HrYnUr9O6ZTwbDfAHS0nJkxsyS1SkhrM9gSfFC9vKiKeCbqk8V1HGNEvzseJ2OJB7pY7KqQYkEvI4ki8NSVGZJsNuWt4A100k+y5hTKB8y0EsZZm3Jue1e50cxkkkgK5Vug2IngNUYRE9CktsJnp8Rgk0ZmyS/WmTWAk2wvISq0jLawULtwZTukCXHzgjuF9YDsd0s0EY2op8TPtLLQW/BBTxd3wD6rxOs4xP+bsBS/ZirUdtKP1VV6MwDVsf3o39oYY1nUO2TerqcTrRyHbw4I9lx0KqqOaSEKBRG/FhywXhtQyN5cXaR8XhC2XaE1YkcVFaoJm2ORpVgKmuoO3TlmnjKvkiGhL/WbmVQ/NsNZbahhbiq8uloeS5ReUpXZ4RU2zozcPZ6jsalhHGSbLK03nj15NmKsUC3/fqksQihUScO3+KxUWPajbnwJCbCxcqcp1a0yGBy29yOR8o04bON2+CFwlfKP1cK7g7iDTy6GBYm7ZTarnFmb7Vii1YOt1JTPQtUYopY3JTDOLrusaOfvY6PK++hOdjPjuyKbHU2WruafvnjkrzX625Dw3EDoQ2INCjiQdsoHMW8T9SfI+xiCu3EuZ8DIIjJMGzVnIbdQZhHrZb0HAHRUYCS3Q7q4HwiYWsl8lya7rM4pJNvmD+OnuxKhvp0hxA3EDVDAOK6QK71/xeSFBGz9vPvDgOQ9EWK8Qynp/xccQfIXd09fqkXy9sjAP4PhxQjD67dhDKnTcniqAt9DoYiFEGjwZF8l28NXbkBOaQE/eQy4d6jsB1OJwPA5/H4RiKwuVGg7XKB741p92Xn/gvqI7IBl+8Qh/2rTXe+hBgtMzZ85juv4X2/PM4nzAuxl5n/VBOZ0X/CE73xM/WvgooIB0Lab7pM4erxChK1oSF8KAyv0tXnvFoL0ZU7nHQaanFYfkpyAnapfI3sNAw6gU7Z9HhzUUotks7ayjprSqMBGl1mrNuUMjwUpjgIqNKkCaK5wOFHYuusaEHnB2vfQ27UsI6Y5Axj769nTWgoXnRJzgepEAD925Umku+LuWm6DPGLz9PC859VcZK4dAEf+HbOs9h+ayiMMkCE2tCcWxs3GLVSqwJdB2ideIkCvxcT1t+S+JTg+3hdGcr1GuxNUa+PnXzj8KeWh7VBeE7xgGsuxU1KPjIPOwR3/rQs5MGiv/4i3Q0aZW/2/Hm/dHnYLjmxH4nHfqCgS9ZVQ/UpPfO1EeM7JYJIGARaf0JrGpZLB+VpK53Hc3CUYOr5SG4hee20KHFXQg+bbQCIxj9S6Llv9hTa7ByTsGFN/RzBjfIOkaSUtqkkJxcMjfGerU+J8isGfZ5I0Vo0vdAISUARsAk4PysspiCYwxL4Rv4eC53f2+zyHiCaMuq1T8aStY3HmLdFu34vUAkbkDYu/pz7SF3NJUJXDKXaiXDmuJ/esE7RV00HGL0ewN8J0npkmE24zv+YojC3SDezWixjQlmWspsXkgl888Hu0A43b4fXnRsVdIuEIi2XXOnncgL6Fs+HAzo9mDEibfBWSLToAu2oa73gEvAMT5BggMm1Nn/EHb45o8wMK6+E5Uo7Rumv+THfmbE7iB3jsEApRZELJOl4Q88Mc5rvHgkQxMmKQPdALSLL3sZmAwFMOqIcQhQ8YXKZjHp15kH+phJ9VG2JXd0PLWREOVJpmElz3CbZgzbPog9gKOgpERishN/Q2wCHE8HFzKIgY5pO4/qLPWP1MPGzJOyi8t2lQoIOfCxGh/7XO2BoQtM7bFzBSJh3AJ5jZLbtfX00KJUkek47aap0RLcPkQ6YgrqpLphBNW6sV6H/fautvOrmWY4vB3vX7TckGnVZbaaq/Ww1ySam/nSAfc7DDOuBxpCUHIyQJvbWfvg0yAyJ56JDJznG0fDN7GEaarvJeIn/uyJB0UE9E9MvIT63ppd5xeGlZqfN2B075KiRT7voj1VQZKrcJZ5SaKmTcoh2A8Kh/ofxWKpyO7iPqXT1kyhzcoOF2b6PmpzsA0o2q6IEVKweq1GiXiparBR8x1XeKZuaRNc2hum61UPfEuVM4ir2egHfxe6JZi9Dcr0n1jqIDAwgJhiIv1zv3ZcDa2J8D3CyFd15Qy7KCvQSa98pUOF5T4mfhC7OVvHLcoHDBuWFa2CCSATkRXo7pRYZvAn+q5uLkX9WdrfpnJbRoR6IlHcwoFr008+2OEtNwHPDusV2rX1N/fyS0DHlOFRuia+Peen4jYi2B5o5BraJK677RPP43/3G5q2DLhoqyYBne6pmQ3pDOFW+rH9trd+aHAR3R9N0Z6TQ9UcCuC/RBDJ3X7nATBMRPkxenccBhUuFEqKz+fHOypwAA==' },
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
  /* 面板是一列：中间内容自己滚，底栏绝对定位贴死在面板底边（浮在内容之上） */
  display:flex;
  flex-direction:column;
  position:relative;
  height:100%;
  max-height:100%;
  min-height:0;
  min-width:0;
  color:var(--ea-ink);
  font:13px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI Variable","Segoe UI","Microsoft YaHei",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;
}
.ea *{box-sizing:border-box}
/* 全部直角：面板里所有圆角一律取消（卡片、按钮、胶囊、徽标、缩略图、底栏都对上边） */
.ea,.ea *,.ea *::before,.ea *::after{border-radius:0 !important}
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
.ea-chk{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--ea-soft);cursor:pointer;
  padding:7px 10px;border:1px solid var(--ea-line);background:var(--ea-bg);white-space:nowrap}
.ea-chk input{margin:0;cursor:pointer}
.ea-chk:hover{border-color:var(--ea-line2);color:var(--ea-ink)}
.ea-inp{flex:1 1 150px;min-width:130px}
.ea-inp::placeholder{color:var(--ea-dim)}
.ea-sel:focus,.ea-inp:focus{outline:none;border-color:var(--ea-acc);box-shadow:0 0 0 3px rgba(0,168,112,.14)}
.ea-lib{font-size:11.5px;color:var(--ea-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  min-width:0;max-width:100%;flex:0 1 auto}

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
  min-width:0;overflow-wrap:anywhere;word-break:break-word;
  background:var(--ea-paper);border:1px solid var(--ea-line);line-height:1.75}
.ea-note.warn{color:var(--ea-warn);background:rgba(150,116,59,.08);border-color:rgba(150,116,59,.28)}
.ea-note.bad{color:var(--ea-danger);background:rgba(180,89,80,.08);border-color:rgba(180,89,80,.28)}
.ea-note .ea-btn{padding:4px 9px;font-size:11.5px;border-radius:8px;margin-left:2px}

/* 自动找到的动作库候选 */
.ea-libs{margin:0 0 12px;display:flex;flex-direction:column;gap:6px}
.ea-libs .head{font-size:12px;color:var(--ea-soft)}
.ea-librow{flex-direction:column;align-items:flex-start;gap:2px;text-align:left;padding:8px 11px;white-space:normal}
.ea-librow b{font-weight:600;font-size:12px;color:var(--ea-ink);word-break:break-all;white-space:normal}
.ea-librow span{font-size:11.5px;color:var(--ea-dim);white-space:normal}
.ea-librow.on{border-color:var(--ea-acc);box-shadow:0 0 0 2px rgba(0,168,112,.14)}

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
/* 已装条折叠：段数多的时候只显示前几段，剩下的收起来 */
.ea-installed .inst-toggle{border:1px solid var(--ea-line);background:var(--ea-sheet2);color:var(--ea-dim);
  cursor:pointer;font-size:11.5px;padding:3px 10px;border-radius:999px;transition:all .15s}
.ea-installed .inst-toggle:hover{color:var(--ea-fg);border-color:var(--ea-line2);background:var(--ea-sheet3)}
.ea-installed .more{color:var(--ea-dim);font-size:11.5px}

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
/* 缩略图按素材原始比例（240×135 ≈ 16:9）显示：不再用方形盒 + cover 裁切，
   否则高分屏(150%/200%)下会把窄边放大而发虚 */
.ea-row img,.ea-row .ea-ph{width:64px;height:36px;border-radius:8px;flex:none;object-fit:cover;
  background:var(--ea-sheet2);border:1px solid var(--ea-line)}
.ea-row .t{min-width:0;flex:1}
.ea-row .t b{display:block;font-size:12.8px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ea-row .t code{display:block;background:none;padding:0;font-size:10.5px;color:var(--ea-dim);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ea-row .tag{display:inline-block;font-size:10px;color:var(--ea-soft);border:1px solid var(--ea-line);
  border-radius:6px;padding:0 5px;margin:3px 4px 0 0;line-height:16px;background:var(--ea-paper)}
.ea-row .tag.acc{color:var(--ea-acc);border-color:rgba(0,168,112,.35);background:rgba(0,168,112,.08)}
.ea-row .tag.warn{color:var(--ea-warn);border-color:rgba(150,116,59,.35);background:rgba(150,116,59,.10)}
.ea-row.miss{border-style:dashed}
.ea-row.miss img{filter:grayscale(1) opacity(.55)}
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

/* 中间可滚动区：动作列表在这里滚，头部与底栏都不动。
   padding-bottom 给"浮在底上的任务栏"留出高度（JS 里按底栏实际高度补，见 fitFoot） */
.ea code,.ea .ea-lib,.ea .sum,.ea .ea-msg,.ea .ea-menu-body .hint{overflow-wrap:anywhere}
.ea-pin{flex:1 1 auto;min-height:0;min-width:0;overflow-y:auto;scrollbar-gutter:stable;
  padding-right:2px;margin-right:-2px;padding-bottom:72px}

/* 首启一次性提示 */
.ea-onboard{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;
  background:rgba(0,0,0,.42);padding:20px}
.ea-onboard-box{max-width:420px;background:var(--ea-bg);border:1px solid var(--ea-line2);padding:16px 18px;
  box-shadow:0 24px 48px -20px rgba(0,0,0,.5)}
.ea-onboard-box b{display:block;font-size:14px;margin-bottom:6px}
.ea-onboard-box p{margin:0 0 8px;font-size:12.5px;line-height:1.7;color:var(--ea-soft)}
.ea-onboard-box p.ea-dim{color:var(--ea-dim);font-size:11.5px}
.ea-onboard-acts{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}

/* 底栏＝任务栏：sticky 粘在滚动视口底部（宿主滚或面板滚都生效），浮在列表上方 */
.ea-foot{position:absolute;left:0;right:0;bottom:0;z-index:8;margin:0;padding:10px 12px;
  display:flex;gap:10px;align-items:center;flex-wrap:wrap;
  background:var(--ea-bg);                     /* 老浏览器兜底：实色 */
  background:color-mix(in srgb, var(--ea-bg) 92%, transparent);
  -webkit-backdrop-filter:saturate(1.15) blur(10px);
  backdrop-filter:saturate(1.15) blur(10px);
  border-top:1px solid var(--ea-line);
  box-shadow:0 -14px 28px -20px rgba(0,0,0,.45),0 -1px 0 rgba(0,0,0,.04)}
.ea-foot .sum{font-size:12.5px;color:var(--ea-soft);min-width:0;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap}
.ea-foot .sum b{color:var(--ea-ink);font-size:13.5px;font-variant-numeric:tabular-nums}
.ea-foot .sp{flex:1 1 8px}
.ea-foot .ea-actions{display:flex;gap:8px;flex-wrap:wrap;flex:0 0 auto}
/* 内容底部留一点，避免最后一行贴着底栏 */
.ea [data-role=list]{padding-bottom:2px}

/* 动作库 ▾：三个"选库"入口收进一个菜单，少一排按钮 */
.ea-menu{position:relative;display:inline-block}
.ea-menu>summary{list-style:none;cursor:pointer}
.ea-menu>summary::-webkit-details-marker{display:none}
.ea-menu>summary::after{content:"";display:inline-block;width:0;height:0;margin-left:6px;vertical-align:middle;
  border:4px solid transparent;border-top-color:currentColor;transform:translateY(1px);opacity:.7}
.ea-menu[open]>summary{border-color:var(--ea-acc);color:var(--ea-acc)}
.ea-menu-body{position:absolute;z-index:20;top:calc(100% + 6px);left:0;min-width:220px;padding:5px;
  background:var(--ea-paper);border:1px solid var(--ea-line2);border-radius:12px;
  box-shadow:0 12px 26px -14px rgba(0,0,0,.4),0 2px 6px -2px rgba(0,0,0,.2);display:flex;flex-direction:column}
.ea-menu-body button{text-align:left;border:0;background:transparent;color:var(--ea-ink);cursor:pointer;
  padding:8px 10px;border-radius:8px;font-size:12.5px;white-space:nowrap}
.ea-menu-body button:hover{background:var(--ea-sheet2)}
.ea-menu-body .sep{height:1px;margin:4px 6px;background:var(--ea-line)}
.ea-menu-body .hint{padding:4px 10px 6px;font-size:11px;color:var(--ea-dim);white-space:normal;line-height:1.5}

/* 消息行 */
.ea-guide{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;padding:10px 12px;margin:0 0 12px;
  border:1px solid var(--ea-line);border-radius:12px;background:var(--ea-paper);font-size:12px;line-height:1.5}
.ea-guide>b{color:var(--ea-ink);font-weight:650;white-space:nowrap;padding-top:1px}
.ea-guide .s{display:flex;flex-direction:column;gap:1px;min-width:0;max-width:230px}
.ea-guide .s i{font-style:normal;display:inline-grid;place-items:center;width:15px;height:15px;border-radius:50%;
  background:var(--ea-acc);color:#fff;font-size:10px;font-weight:700;margin-right:4px}
.ea-guide .s .d{color:var(--ea-dim);font-size:11px;padding-left:19px}
.ea-guide .a{color:var(--ea-dim);opacity:.6;padding-top:1px}
.ea-msg{font-size:12.5px;min-height:18px;color:var(--ea-dim);transition:color .15s}
.ea-msg.bad{color:var(--ea-danger)}
.ea-msg.ok{color:var(--ea-ok)}

/* 分类表头：整行可点（折叠/展开），行首一个全选复选框 */
.ea-sec{cursor:pointer;user-select:none;border-radius:9px;padding:2px 6px 2px 2px;margin-left:-6px}
.ea-sec:hover{background:var(--ea-sheet2)}
.ea-sec .caret{display:inline-block;font-size:14px;line-height:1;color:var(--ea-dim);flex:none;
  transform:rotate(90deg);transition:transform .15s}
.ea-sec.collapsed .caret{transform:rotate(0deg)}
.ea-sec input{accent-color:var(--ea-acc);width:15px;height:15px;flex:none;cursor:pointer;margin:0}
.ea-sec input:disabled{cursor:default;opacity:.45}
.ea-list[hidden]{display:none}

/* 缩略图还没挂 src 时的占位（懒加载）：尺寸由 .ea-row img 给定，行不会因此跳动 */
.ea-row img[data-role=thumb]:not([src]){background:linear-gradient(100deg,var(--ea-sheet2) 30%,var(--ea-sheet3) 50%,var(--ea-sheet2) 70%)}

/* 行内预览 */
.ea-pvbtn{border:1px solid var(--ea-line);background:var(--ea-bg);color:var(--ea-soft);border-radius:8px;
  padding:2px 7px;font-size:11px;cursor:pointer;flex:none;transition:all .15s}
.ea-pvbtn:hover{color:var(--ea-acc);border-color:rgba(0,168,112,.45);background:rgba(0,168,112,.07)}
.ea-pv{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;
  background:rgba(12,12,14,.55)}
.ea-pv[hidden]{display:none}
.ea-pv-box{background:var(--ea-bg);border:1px solid var(--ea-line);border-radius:16px;padding:12px 14px 10px;
  max-width:min(680px,92vw);box-shadow:0 24px 60px -24px rgba(0,0,0,.6)}
.ea-pv-head{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.ea-pv-head b{font-size:13px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ea-pv-head .ea-btn{padding:4px 9px;font-size:11.5px;border-radius:8px}
.ea-pv-img{display:block;width:min(640px,84vw);height:auto;border-radius:10px;background:var(--ea-sheet2);
  border:1px solid var(--ea-line)}
.ea-pv-img:not([src]){min-height:120px}
.ea-pv-foot{margin-top:8px;font-size:11.5px;color:var(--ea-dim);word-break:break-all}
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
    /** 折起来的分类（默认全展开）。只记用户点过的，搜索/筛选/切分类都保留。 */
    const collapsed = new Set();
    /** 「包里已装」那条要不要展开（默认收起，只显示前几段）。 */
    let instOpen = false;
    /** 默认只列库里真有的动作；勾上开关才把完整 105 条目录（含未下载）也列出来。 */
    let showAll = false;

    /* ---------- 骨架 ---------- */
    wrap.innerHTML = `
      <div class="ea-pin">
      <div class="ea-h">
        <div>
          <h2>深深与额外动作拓展</h2>
          <p>勾中的动作写进形象包的 <code>额外动作拓展/</code> 文件夹，<b>勾了什么，桌宠就只做这些</b>：
             待机轮播、点击回应、以及 bot 能说的动作词，都收在这次勾选里；没勾的动作不会自己冒出来。</p>
        </div>
        <div class="tools">
          <span class="ea-badge" data-role="badge"><span class="dot"></span>准备中</span>
          </div>
      </div>
      <div class="ea-guide">
        <b>四步就能用</b>
        <span class="s"><i>1</i>选动作库<span class="d">没有完整库就点上面的「动作库」菜单 →「自动寻找动作库…」，或把解压出来的「深深-动作库」选进来</span></span>
        <span class="a">›</span>
        <span class="s"><i>2</i>勾动作<span class="d">勾中的才会写进形象包，没勾的桌宠不会做</span></span>
        <span class="a">›</span>
        <span class="s"><i>3</i>保存到形象包<span class="d">右下角那个绿色按钮</span></span>
        <span class="a">›</span>
        <span class="s"><i>4</i>装扮页重新点一下形象<span class="d">插件不碰桌宠，这一步才会真正生效</span></span>
      </div>
      <div class="ea-bar">
        <select class="ea-sel" data-role="pack"></select>
        <input class="ea-inp" data-role="q" placeholder="搜名字 / id…">
        <label class="ea-chk" data-role="showall-wrap" title="默认只列动作库里真有的动作；勾上可以看完整的 105 条目录（未下载的勾了也写不进包）">
          <input type="checkbox" data-role="showall"><span data-role="showall-txt">显示全部</span>
        </label>
        <details class="ea-menu" data-role="libmenu">
          <summary class="ea-btn" title="动作库可以放在任意盘，路径会被记住">动作库</summary>
          <div class="ea-menu-body">
            <button type="button" data-act="library" title="手动指一个已有的动作库目录">选择动作库位置…</button>
            <button type="button" data-act="find-libs" title="自动扫一遍本机像动作库的目录，列出来点一下就用">自动寻找动作库…</button>
            <button type="button" data-act="starter-library" title="在你会选的目录下建一个自带示例动作库（3 段）并设为当前库">用自带示例建库…</button>
            <div class="sep"></div>
            <div class="hint" data-role="libhint">当前库见右下方状态行</div>
          </div>
        </details>
        <button class="ea-btn" data-act="restore-pack" title="建一个空的角色包（只有身体状态），位置自己选">建立空的角色包（选位置）</button>
        <span class="ea-lib" data-role="lib"></span>
      </div>
      <div class="ea-pin">
      <div class="ea-note" data-role="note" hidden></div>
      <div class="ea-libs" data-role="libs" hidden></div>
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
          <div style="margin-top:6px">动作库是固定的那一个文件夹（路径见上面的状态行），不需要另外下载任何东西。
            <br>想换位置：点上面的「动作库」菜单（自动寻找 / 选择位置 / 用自带示例建库）。</div>
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
      </div>
      <div class="ea-foot">
        <span class="sum" data-role="sum"></span>
        <span class="sp"></span>
        <div class="ea-actions">
          <button class="ea-btn" data-act="none">清空勾选</button>
          <button class="ea-btn" data-act="all">全选可点名</button>
          <button class="ea-btn" data-act="prune" title="删掉包里用不到的动作模块">压缩包</button>
          <button class="ea-btn dan" data-act="clear">清空随机动作列表</button>
          <button class="ea-btn pri" data-act="save">保存随机列表</button>
        </div>
      </div>
      <div class="ea-onboard" data-role="onboard" hidden>
        <div class="ea-onboard-box">
          <b>完整动作库还没下载</b>
          <p>插件自带 <b data-role="onboard-have">若干</b> 段示例动作。完整库有 <b data-role="onboard-count">105</b> 段（640×360，约 <span data-role="onboard-size">370</span> MB），下载并指给插件之后，面板里的动作才能全部勾选。</p>
          <p class="ea-dim" data-role="onboard-note">下载地址由维护者提供，拿到后这里会出现「去下载」按钮；也可以自己放好库，用「动作库」菜单里的「选择动作库位置…」指过去。</p>
          <div class="ea-onboard-acts">
            <a class="ea-btn pri" data-role="onboard-go" target="_blank" rel="noreferrer" hidden>去下载</a>
            <button class="ea-btn" type="button" data-act="onboard-dismiss">知道了</button>
          </div>
        </div>
      </div>
      <div class="ea-pv" data-role="pv" hidden>
        <div class="ea-pv-box">
          <div class="ea-pv-head">
            <b data-role="pv-title">预览</b>
            <button class="ea-btn" type="button" data-act="pv-close" title="关闭预览">关闭</button>
          </div>
          <img class="ea-pv-img" data-role="pv-img" alt="">
          <div class="ea-pv-foot" data-role="pv-foot"></div>
        </div>
      </div>`;

    /* 模板自检：少一个节点就当场炸，别留成静默 null */
    const REQUIRED = [
      '[data-role=pack]', '[data-role=q]', '[data-role=lib]', '[data-role=note]', '[data-role=libs]',
      '[data-role=installed]', '[data-role=chips]', '[data-role=list]', '[data-role=sum]',
      '.ea-foot', '[data-act=save]', '[data-act=clear]', '[data-act=add]', '[data-act=prune]', '[data-act=library]',
      '[data-role=libmenu]', '[data-role=showall]',
      '[data-act=restore-pack]', '[data-act=find-libs]', '[data-act=starter-library]',
      '[data-role=onboard]', '[data-act=onboard-dismiss]',
      '[data-role=pv]', '[data-role=pv-img]', '[data-role=pv-title]', '[data-role=pv-foot]', '[data-act=pv-close]',
    ];
    const missing = REQUIRED.filter((sel) => !wrap.querySelector(sel));
    if (missing.length) throw new Error('面板模板缺少节点：' + missing.join(', '));

    const $ = (sel) => wrap.querySelector(sel);
    const packSel = $('[data-role=pack]');
    const qInp = $('[data-role=q]');
    const noteEl = $('[data-role=note]');
    const libsEl = $('[data-role=libs]');
    const chipsEl = $('[data-role=chips]');
    const installedEl = $('[data-role=installed]');
    const listEl = $('[data-role=list]');
    const sumEl = $('[data-role=sum]');
    const libEl = $('[data-role=lib]');
    const footEl = wrap.querySelector('.ea-foot');
    const pinEl = wrap.querySelector('.ea-pin');
    /** 底栏是浮在内容上的，给它实际高度在滚动区底部留出等量空白，最后一行才不会被压住。 */
    const fitFoot = () => {
      const h = Number(footEl?.offsetHeight) || 0;
      if (pinEl) pinEl.style.paddingBottom = (h ? h + 12 : 72) + 'px';
    };
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', fitFoot);
    const onboardEl = $('[data-role=onboard]');
    /** 本次打开面板只自动弹一次，点「知道了」之后靠 config.json 里的标记永久不再弹。 */
    let onboardShown = false;
    const pvEl = $('[data-role=pv]');
    const pvImg = $('[data-role=pv-img]');
    const pvTitle = $('[data-role=pv-title]');
    const pvFoot = $('[data-role=pv-foot]');

    /** 首次打开、且完整动作库还没下载时，弹一次「完整动作库还没下载」。 */
    function maybeOnboard() {
      if (!onboardEl || onboardShown) return;
      const ob = state?.onboard;
      const missing = catalog?.missing ?? 0;
      if (!ob || ob.seen || missing <= 0) return;   // 看过 / 库是完整的 → 不弹
      onboardShown = true;
      const go = wrap.querySelector("[data-role=onboard-go]");
      const note = wrap.querySelector("[data-role=onboard-note]");
      if (go) {
        if (ob.downloadUrl) { go.href = ob.downloadUrl; go.hidden = false; }
        else go.hidden = true;
      }
      if (note) note.hidden = !!ob.downloadUrl;
      // 数字都从清单算，别写死（换库、加动作时不用改文案）
      const totalSeg = catalog?.count ?? 0;
      const haveSeg = catalog?.present ?? 0;
      const totalBytes = (catalog?.actions ?? []).reduce((sum, a) => sum + (a.bytes || 0), 0);
      const setTxt = (sel, v) => { const node = wrap.querySelector(sel); if (node) node.textContent = String(v); };
      if (totalSeg) setTxt('[data-role=onboard-count]', totalSeg);
      setTxt('[data-role=onboard-have]', haveSeg);
      if (totalBytes) setTxt('[data-role=onboard-size]', Math.round(totalBytes / 1048576));
      onboardEl.hidden = false;
    }

    /** 开关文案：默认状态写清"还藏着 N 段没下载"，没有隐藏项时整个开关隐藏。 */
    function renderShowAll() {
      const wrapEl = wrap.querySelector("[data-role=showall-wrap]");
      const txtEl = wrap.querySelector("[data-role=showall-txt]");
      const hidden = (catalog?.actions ?? []).filter((a) => a.present === false).length;
      if (wrapEl) wrapEl.hidden = hidden === 0;
      if (showAllInp) showAllInp.checked = showAll;
      if (txtEl) txtEl.textContent = showAll ? `看全部（含未下载 ${hidden} 段）` : `显示全部 ${hidden} 段未下载的`;
    }

    const pack = () => state?.figures?.find((f) => f.id === packId) ?? null;
    const wordCount = () => (catalog?.actions ?? []).filter((a) => a.word).length;
    const bytesOf = (ids) => {
      const set = new Set(ids);
      return (catalog?.actions ?? []).filter((a) => set.has(a.id)).reduce((n, a) => n + (a.bytes || 0), 0);
    };

    /* ---------- 行能不能勾 ---------- */
    /** 身体状态（待机/走路这种）和库里还没有的，都不能勾 —— 行里也是 disabled，两边必须同一套判断。 */
    const isSelectable = (a) => !!a.word
      && a.present !== false
      && !(Array.isArray(a.roles) && a.roles.length > 0);
    /** 一组里可勾的那些。全选只认这个数组、不认 DOM，所以折叠起来也不会漏。 */
    const selectableOf = (rows) => rows.filter(isSelectable);

    /* ---------- 缩略图懒加载 ---------- */
    /**
     * 行先渲染出来（尺寸由 CSS 的 64×36 定住，不挂 src 也不会跳动），
     * 只有真的进可视区（上下再放宽 200px）才把 data URL 挂到 src 上。
     * 环境里没有 IntersectionObserver 就直接全挂 —— 功能优先，不抛错。
     *
     * 全表共用**一个** observer：折叠区是 10 个网格，每个网格各建一个的话
     * 后建的会把前一个 disconnect 掉，前面几个网格的缩略图就永远不加载了。
     * 整体重绘前统一 disconnect（见 renderList 开头）。
     */
    let thumbIO = null;
    /** 把某一行的 data-src 挂到 src 上（挂过就把 data-src 删掉，重复 observe 也不会重复赋值）。 */
    const flushThumb = (im) => {
      const src = im?.dataset?.src;
      if (!src) return;
      im.src = src;
      delete im.dataset.src;
    };
    const ensureThumbIO = () => {
      if (thumbIO || typeof IntersectionObserver !== 'function') return thumbIO;
      try {
        thumbIO = new IntersectionObserver((entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            flushThumb(e.target);
            thumbIO?.unobserve?.(e.target);
          }
        }, { root: null, rootMargin: '200px' });
      } catch {
        thumbIO = null;
      }
      return thumbIO;
    };
    const mountThumbs = (scope) => {
      if (!scope || typeof scope.querySelectorAll !== 'function') return;
      const imgs = [...scope.querySelectorAll('img[data-role=thumb]')].filter((im) => im?.dataset?.src);
      if (!imgs.length) return;
      const io = ensureThumbIO();
      if (!io) { for (const im of imgs) flushThumb(im); return; }   // 退化：直接全挂
      for (const im of imgs) io.observe(im);
    };

    /* ---------- 分类折叠 ---------- */
    /** 只切 DOM 上的这一组，不整表重绘：折叠一下不该把 105 行的缩略图重新走一遍懒加载。 */
    const toggleCat = (sec, cid) => {
      const nowCollapsed = !collapsed.has(cid);
      if (nowCollapsed) collapsed.add(cid); else collapsed.delete(cid);
      if (sec) {
        sec.classList.toggle('collapsed', nowCollapsed);
        const grid = sec.nextElementSibling;
        if (grid) grid.hidden = nowCollapsed;
      }
    };

    /* ---------- 行内预览 ---------- */
    let pvSeq = 0;
    const closePreview = () => {
      pvSeq++;
      if (pvEl) pvEl.hidden = true;
      if (pvImg) pvImg.removeAttribute?.('src');
    };
    const openPreview = async (a) => {
      if (!pvEl || !a) return;
      const seq = ++pvSeq;
      pvEl.hidden = false;
      if (pvTitle) pvTitle.textContent = `${a.zh} · ${a.seconds.toFixed(1)}s`;
      if (pvImg) pvImg.removeAttribute?.('src');
      if (pvFoot) pvFoot.textContent = '正在读取高清动图…';
      try {
        const r = await ctx.invoke('preview', [a.id]);
        if (seq !== pvSeq) return;                    // 期间又点了别的/已经关掉
        if (pvImg && r?.dataUrl) pvImg.src = r.dataUrl;
        if (pvFoot) {
          pvFoot.textContent = `${mb(r?.bytes ?? 0)} · ${a.dir || a.clip || ''}` + (r?.cached ? ' · 已缓存' : '');
        }
      } catch (err) {
        if (seq !== pvSeq) return;
        if (pvFoot) pvFoot.textContent = '预览不了：' + String(err?.message ?? err);
      }
    };
    if (pvEl) {
      pvEl.onclick = (e) => { if (e.target === pvEl) closePreview(); };   // 点浮层外的暗底就关掉
    }

    function renderPack() {
      const list = (state?.figures ?? []).filter((f) => f.supported && !f.builtin);
      packSel.innerHTML = '';
      if (!list.length) {
        packSel.appendChild(el('option', null, '没有可写的角色包（点「建立空的角色包」）'));
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
        if (!showAll && a.present === false) continue;   // 默认不统计库里没有的
        if (!byCat.has(a.category)) byCat.set(a.category, { id: a.category, zh: a.catZh || a.category, count: 0 });
        byCat.get(a.category).count++;
      }
      const cats = [...byCat.values()];
      const total = { id: 'all', zh: '全部', count: (catalog?.actions ?? []).filter((a) => showAll || a.present !== false).length };
      chipsEl.innerHTML = '';
      for (const c of [total, ...cats]) {
        const b = el('button', 'ea-chip' + (cat === c.id ? ' on' : ''), `${esc(c.zh)} <span style="opacity:.7">${c.count}</span>`);
        b.type = 'button';
        b.onclick = () => {
          cat = c.id;
          collapsed.clear();          // 切分类/看全部时一律展开：否则点进去可能是几个折叠的表头，看着像空的
          renderChips(); renderList();
        };
        chipsEl.appendChild(b);
      }
    }

    function rowOf(a) {
      const isState = !a.word || (Array.isArray(a.roles) && a.roles.length > 0);
      const off = a.present === false;              // 库里还没有这一段的帧
      const on = selected.has(a.id);
      const mounted = installed.has(a.id);
      const row = el('div', 'ea-row' + (on ? ' on' : '') + (isState || off ? ' off' : '') + (off ? ' miss' : ''));
      // 目录固定：悬停就能看到这段动作在库里的固定位置 actions/<分类>/<id>
      row.title = '固定目录：' + (a.dir || a.clip || `actions/${a.category}/${a.id}`) + (off ? '（库里还没有，补进来才能用）' : '');
      // 缩略图的 data URL 先不挂 src：等这一行进可视区再挂（见 mountThumbs）。
      // 尺寸由 CSS 的 64×36 定住，所以不挂 src 也不会让行跳动。
      row.__pickable = isSelectable(a) ? a : null;   // 表头复选框要用：这一行到底算不算"可勾"
      row.innerHTML = `
        ${a.thumb ? '<img data-role="thumb" alt="" width="64" height="36" loading="lazy" decoding="async">' : `<span class="ea-ph">${esc((a.zh || "?").slice(0, 1))}</span>`}
        <div class="t">
          <b>${esc(a.zh)}</b>
          <code>${esc(a.id)}</code>
          <div>
            <span class="tag">${esc(a.catZh)}</span>
            <span class="tag">${a.seconds.toFixed(1)}s</span>
            ${mounted ? '<span class="tag acc">已装</span>' : ''}
            ${off ? '<span class="tag warn">库里没有 · 缺帧</span>' : (isState ? '<span class="tag">状态 · 不用勾</span>' : '')}
            ${a.reaction ? '<span class="tag">点击</span>' : ''}
            ${a.noMirror ? '<span class="tag">带字</span>' : ''}
            ${a.random ? '' : '<span class="tag">不轮播</span>'}
          </div>
        </div>
        ${off ? '' : `<button class="ea-pvbtn" type="button" data-pv="${esc(a.id)}" title="先看一眼这一段">预览</button>`}
        ${mounted ? '<button class="ea-x" type="button" title="从包里删掉这一段" aria-label="删除">×</button>' : ''}
        <input type="checkbox" ${on ? 'checked' : ''} ${isState || off ? 'disabled' : ''}>`;
      const thumb = row.querySelector('img[data-role=thumb]');
      if (thumb) thumb.dataset.src = a.thumb;       // 真源先藏起来，由 mountThumbs 按需挂
      row.onclick = (e) => {
        if (e.target.closest('[data-pv]')) { openPreview(a); return; }   // 预览按钮自己处理
        if (e.target.closest('.ea-x')) return;                          // × 交给它自己的处理
        if (isState || off) return;                                     // 状态行 / 缺帧行：只有预览可点
        const box = row.querySelector('input');
        if (e.target !== box) box.checked = !box.checked;
        if (box.checked) selected.add(a.id); else selected.delete(a.id);
        row.classList.toggle('on', box.checked);
        renderSum();
        syncCatBox(row);                              // 顺手把这一类的表头复选框对齐
      };
      return row;
    }

    /** 勾选变化后同步该行所在分类的表头复选框（含 indeterminate），避免"勾了但不显示半选"。 */
    function syncCatBox(row) {
      const grid = row?.parentElement;
      const sec = grid?.previousElementSibling;
      if (!grid || !sec) return;
      const box = sec.querySelector?.('input');
      if (!box) return;
      const cid = sec.dataset?.cat;
      const rows = [...grid.querySelectorAll('.ea-row')];
      if (!rows.length || !cid) return;
      const pickable = rows.map((r) => r.__pickable).filter(Boolean);
      const picked = pickable.filter((a) => selected.has(a.id)).length;
      const allOn = pickable.length > 0 && picked === pickable.length;
      box.checked = allOn;
      box.indeterminate = picked > 0 && !allOn;
      const n = sec.querySelector('.n');
      if (n) n.textContent = `${picked}/${pickable.length} 已选 · 共 ${rows.length}`;
    }

    /**
     * 已装的一段一段列出来，每段带一个 × —— 这就是"删除单个动作拓展"。
     * 段数多的时候（勾满一百多段的场景）默认只显示前 3 段，其余收进一行「展开全部」，
     * 免得这一条把下面的动作列表顶下去；展开状态在这个面板里记住。
     */
    const INST_COLLAPSE_AT = 8;   // 超过这么多段才折叠
    const INST_SHOW_COLLAPSED = 3; // 收起时显示前几段
    function renderInstalled() {
      const ids = [...installed];
      installedEl.hidden = ids.length === 0;
      if (!ids.length) { installedEl.innerHTML = ''; return; }
      const folded = !instOpen && ids.length > INST_COLLAPSE_AT;
      const shown = folded ? ids.slice(0, INST_SHOW_COLLAPSED) : ids;
      installedEl.innerHTML = `<span class="lab">包里已装 ${ids.length} 段：</span>`;
      for (const id of shown) {
        const a = catalog?.actions.find((x) => x.id === id);
        const pill = el('span', 'ea-pill', `${esc(a?.zh ?? id)}<button type="button" data-act="remove" data-id="${esc(id)}" title="删掉这一段">×</button>`);
        installedEl.appendChild(pill);
      }
      if (folded) {
        const more = el('span', 'more', `…还有 ${ids.length - INST_SHOW_COLLAPSED} 段`);
        installedEl.appendChild(more);
        const b = el('button', 'inst-toggle', `展开全部 ${ids.length} 段 ▾`);
        b.type = 'button';
        b.dataset.inst = 'toggle';
        b.title = '展开看全部已装动作；每段后面的 × 可以单独删掉';
        b.onclick = (ev) => { ev?.stopPropagation?.(); instOpen = true; renderInstalled(); };
        installedEl.appendChild(b);
      } else if (ids.length > INST_COLLAPSE_AT) {
        const b = el('button', 'inst-toggle', '收起 ▴');
        b.type = 'button';
        b.dataset.inst = 'toggle';
        b.title = '收起，只显示前几段';
        b.onclick = (ev) => { ev?.stopPropagation?.(); instOpen = false; renderInstalled(); };
        installedEl.appendChild(b);
      }
      const hint = el('span', 'lab', '（× 直接删掉这一段；要改就重新勾选后保存）');
      installedEl.appendChild(hint);
    }

    function renderList() {
      const acts = (catalog?.actions ?? []).filter((a) => {
        if (!showAll && a.present === false) return false;   // 默认不列库里没有的
        if (cat !== 'all' && a.category !== cat) return false;
        if (!query) return true;
        const q = query.toLowerCase();
        return a.id.toLowerCase().includes(q) || a.zh.includes(query) || (a.say || '').includes(query);
      });
      listEl.innerHTML = '';
      if (!acts.length) {
        const hidden = (catalog?.actions ?? []).filter((a) => a.present === false).length;
        const msg = (query || cat !== 'all')
          ? '没有匹配的动作。'
          : (hidden
            ? `动作库里现在还没有动作（清单里还有 ${hidden} 段没下载）。到「动作库」菜单补齐，或勾上「显示全部」先看完整目录。`
            : '动作库里现在还没有动作，到「动作库」菜单补齐。');
        listEl.appendChild(el('div', 'ea-note', msg));
        return;
      }
      const groups = new Map();
      for (const a of acts) {
        if (!groups.has(a.category)) groups.set(a.category, []);
        groups.get(a.category).push(a);
      }
      // 整表要重建了：先把上一轮的观察目标全放掉，再按新的行重新观察（observer 复用同一个）
      thumbIO?.disconnect?.();
      for (const [cid, rows] of groups) {
        /* 表头：整行可点 = 折叠/展开；行首复选框 = 这一类全选/全不选。
           全选的范围是 **这一组在当前筛选下的 rows**（不是 DOM 里能看见的那些），
           所以折叠起来以后点全选也不会漏；库里没有的（present:false）和身体状态
           本来就不是"可勾"的（isSelectable），全选也不会去动它们。 */
        const pickable = selectableOf(rows);
        const picked = pickable.filter((a) => selected.has(a.id)).length;
        const allOn = pickable.length > 0 && picked === pickable.length;
        const folded = collapsed.has(cid);
        const sec = el('div', 'ea-sec' + (folded ? ' collapsed' : ''));
        sec.dataset.cat = cid;
        sec.title = folded ? '点一下展开这一类' : '点一下折起这一类';
        sec.innerHTML = `<span class="caret" aria-hidden="true">›</span>
          <input type="checkbox"${allOn ? ' checked' : ''}${pickable.length ? '' : ' disabled'}
            aria-label="全选 ${esc(rows[0].catZh)}" title="选中这一类里库里有的全部动作（${pickable.length} 段）">
          <h3>${esc(rows[0].catZh)}</h3>
          <span class="n">${picked}/${pickable.length} 已选 · 共 ${rows.length}</span><span class="sp"></span>`;
        const box = sec.querySelector('input');
        if (box) {
          box.indeterminate = picked > 0 && !allOn;
          box.onclick = (e) => {
            e.stopPropagation();                       // 别顺带把这一类折起来
            const wantAll = !(pickable.every((a) => selected.has(a.id)));
            for (const a of pickable) {
              if (wantAll) selected.add(a.id); else selected.delete(a.id);
            }
            renderList(); renderSum();
          };
        }
        sec.onclick = (e) => {
          if (e.target.closest('input')) return;       // 复选框走自己的 onclick
          toggleCat(sec, cid);
          sec.title = collapsed.has(cid) ? '点一下展开这一类' : '点一下折起这一类';
        };
        listEl.appendChild(sec);
        const grid = el('div', 'ea-list');
        grid.hidden = folded;
        for (const a of rows) grid.appendChild(rowOf(a));
        listEl.appendChild(grid);
        mountThumbs(grid);                             // 只给真进可视区的行挂缩略图
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
      const total = catalog?.count ?? 0;
      const have = catalog?.present ?? total;
      const miss = catalog?.missing ?? 0;
      /** 勾选里有多少段是库里没有的（保存时会被跳过，让用户先知道） */
      const dead = catalog ? [...selected].filter((id) => catalog.actions.some((a) => a.id === id && a.present === false)).length : 0;
      const hiddenAll = (catalog?.actions ?? []).filter((a) => a.present === false).length;
      sumEl.innerHTML = `已勾选 <b>${n}</b> 段 · 约 <b>${mb(bytesOf(selected))}</b>`
        + (hiddenAll && !showAll ? `　|　<b class="warn">另有 ${hiddenAll} 段未下载</b>（勾上「显示全部」可看）` : '')
        + `　|　清单 <b>${total}</b> 条：库里 <b>${have}</b>${miss ? ` · <b class="warn">缺 ${miss}</b>` : ''}`
        + (dead ? `　|　<b class="warn">其中 ${dead} 段库里没有</b>（保存时跳过）` : '')
        + (extra ? `　|　包里已有 ${extra} 段（${mb(p.extra.bytes || 0)}）` : '');
    }

    /** 「自动寻找动作库」的结果列表：一行一个候选，点一下就是它。 */
    function renderLibraries(list) {
      libsEl.innerHTML = '';
      if (!Array.isArray(list) || !list.length) { libsEl.hidden = true; return; }
      libsEl.hidden = false;
      libsEl.appendChild(el('div', 'head', '找到这些像动作库的目录 —— 点一个就用它：'));
      for (const l of list) {
        const row = el('button', 'ea-btn ea-librow' + (l.current ? ' on' : ''));
        row.type = 'button';
        row.dataset.act = 'use-lib';
        row.dataset.dir = l.dir;
        const cat = Array.isArray(l.categories) && l.categories.length ? l.categories.join(' / ') : '';
        row.innerHTML = `<b>${esc(l.dir)}</b><span>${l.count} 段${cat ? ' · ' + esc(cat) : ''} · ${esc(l.source)}${l.current ? ' · 当前在用' : ''}</span>`;
        libsEl.appendChild(row);
      }
    }

    function renderNote() {
      const p = pack();
      noteEl.hidden = true;
      noteEl.className = 'ea-note';
      if (!state) return;
      const haveSeg = state.library.present ?? state.library.count;
      const missSeg = state.library.missing ?? Math.max(0, (state.library.count ?? 0) - haveSeg);
      /** 库不完整时把缺的几段点名列出来（最多 6 个），并给出去哪补。 */
      const missLine = () => {
        if (!missSeg) return '';
        const names = (catalog?.actions ?? []).filter((a) => a.present === false).slice(0, 6).map((a) => a.zh || a.id);
        const more = names.length && missSeg > names.length ? '…' : '';
        return `<br>库里还缺 <b class="warn">${missSeg}</b> 段${names.length ? `（${esc(names.join('、'))}${more}）` : ''}`
          + ' —— 这些勾了也写不进包；点上面的「动作库」菜单去补，或到 '
          + ' 到「动作库」菜单下载完整库。';
      };
      if (!state.library.ok) {
        noteEl.hidden = false;
        noteEl.className = 'ea-note bad';
        noteEl.innerHTML = `动作库目录没找到：<code>${esc(state.library.dir || '未设置')}</code> —— 点上面的「动作库」菜单：自动寻找，或手动选位置。`
          + `<br>清单里的 ${state.library.count ?? 105} 段现在都算「库里没有」。`;
        return;
      }
      if (!p) {
        noteEl.hidden = false;
        noteEl.className = 'ea-note warn';
        noteEl.innerHTML = '还没有可写的角色包。点这里<b>建一个空的</b>（只有 4 段身体状态，词表空），位置你自己选： <button class="ea-btn pri" type="button" data-act="restore-pack">建立空的角色包（选位置）</button>';
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
        + missLine()
        + `<br>保存会把 <code>figure.json</code> 的动作词裁成你勾的这些（表情不动），原文备份在 <code>figure.json.bak-额外动作拓展</code>；「清空随机动作列表」可完整还原。`;
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
      selected = new Set([...installed].filter((id) => catalog.actions.some((a) => a.id === id && a.word && a.present !== false)).slice(0, MAX_SELECTED));
      const haveSeg = state.library.present ?? state.library.count;
      libEl.textContent = state.library.ok
        ? `${haveSeg} / ${state.library.count} 段可用　${state.library.dir}`
          + (state.library.imported ? `（自定义 ${state.library.imported}）` : '')
        : '动作库未设置（可放在任意盘）';
      const libHint = wrap.querySelector('[data-role=libhint]');
      if (libHint) {
        libHint.textContent = state.library.ok
          ? `当前库 ${haveSeg}/${state.library.count} 段：${state.library.dir}`
          : '当前还没设置动作库 —— 选「自动寻找动作库…」或「选择动作库位置…」';
      }
      maybeOnboard();
      renderPack(); renderShowAll(); renderChips(); renderList(); renderInstalled(); renderSum(); renderNote(); fitFoot();
    }

    function loadSelectionFor(id) {
      const p = state?.figures?.find((f) => f.id === id);
      installed = new Set(p?.extra?.ids ?? []);
      instOpen = false;   // 换包时回到收起状态，别把上一个包的展开状态带过来
      selected = new Set([...installed].filter((x) => catalog.actions.some((a) => a.id === x && a.word && a.present !== false)).slice(0, MAX_SELECTED));
    }

    /* ---------- 交互 ---------- */
    packSel.onchange = () => {
      packId = packSel.value;
      loadSelectionFor(packId);
      renderList(); renderInstalled(); renderSum(); renderNote();
    };
    qInp.oninput = () => { query = qInp.value.trim(); renderList(); };
    const showAllInp = $('[data-role=showall]');
    if (showAllInp) {
      showAllInp.checked = showAll;
      showAllInp.onchange = () => {
        showAll = !!showAllInp.checked;
        renderShowAll(); renderChips(); renderList(); renderSum(); renderNote();
      };
    }

    wrap.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      // 「动作库 ▾」里点完就收起来，别让菜单挂在打开对话框后面
      const libMenu = wrap.querySelector('[data-role=libmenu]');
      if (libMenu && (act === 'library' || act === 'find-libs' || act === 'starter-library')) libMenu.open = false;
      const busy = (on) => { for (const b of wrap.querySelectorAll('button')) b.disabled = on; };
      try {
        if (act === 'onboard-dismiss') {
          onboardEl.hidden = true;
          try { await ctx.invoke('dismiss-onboard', []); } catch { /* 老版本 world 没有这个方法，忽略 */ }
        } else if (act === 'pv-close') {
          closePreview();
        } else if (act === 'all') {
          for (const a of catalog.actions) if (a.word) selected.add(a.id);
          renderList(); renderSum();
        } else if (act === 'none') {
          selected.clear(); renderList(); renderSum();
        } else if (act === 'save') {
          if (!packId) return say('先选一个形象包', true);
          if (!selected.size) {
            // 一段都没勾 = 不想让它做任何额外动作，等同清空，别丢一个看不懂的报错
            if (!confirm('一段都没勾 —— 等于清空这个包的随机动作列表（词表还原成原样）。继续？')) return;
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
          selected = new Set(r.copied.concat(r.skipped).filter((id) => catalog.actions.some((a) => a.id === id && a.present !== false)));
          {
            const skipped = Array.isArray(r.skipped) ? r.skipped : [];
            const names = skipped.slice(0, 5).map((id) => catalog.actions.find((a) => a.id === id)?.zh ?? id);
            const tail = skipped.length
              ? `；库里没有的 ${skipped.length} 段已跳过${names.length ? `（${names.join('、')}${skipped.length > names.length ? '…' : ''}）` : ''}`
              : '';
            say(`已写入 ${r.count} 段，${mb(r.bytes)}${tail}；词表 +${r.vocab.added.length} −${r.vocab.removed.length}；去装扮页重新点一下这个形象才会生效`, !!skipped.length);
          }
          libEl.textContent = state.library.ok ? `${state.library.present ?? state.library.count} / ${state.library.count} 段可用` : '动作库未设置（可放在任意盘）';
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
          if (!confirm('清空这个角色包的「随机动作列表」？figure.json 里加过的词也会撤掉。')) return;
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
        } else if (act === 'restore-pack') {
          let dir = null;
          try {
            dir = await ctx.pickPath({
              kind: 'directory',
              title: '选择空形象包放在哪（形象包根目录，或根下面的一个文件夹）',
              currentPath: (state?.roots && state.roots[0]) || state?.figuresDir || undefined,
            });
          } catch { dir = null; }
          if (!dir) return say('没有选目录', true);
          if (!confirm('在这个位置建立一个「空的角色包」？\n\n' + dir
            + '\n\n只有 4 段身体状态，没有额外动作、词表空。\n位置必须落在桌宠认的形象包目录里，否则会被拒绝。')) return;
          busy(true); say('正在准备形象包…');
          const r = await ctx.invoke('restore-pack', [dir]);
          if (r.created) say('已创建空的深深形象包 → ' + (r.path || dir));
          else if (r.repaired) say('形象包缺文件，已补齐 → ' + (r.path || dir));
          else say('那个位置已经有这个包了，只做了检查 → ' + (r.path || dir));
          if (r.duplicates && r.duplicates.length) {
            say(`${r.duplicates.length} 个同名包在别的形象包目录里，请自行决定留哪个：` + r.duplicates.map((p) => String(p)).join('、'), true);
          }
          await loadAll();
          if (r.dir) { packSel.value = r.dir; renderNote(); renderList(); renderInstalled(); renderSum(); }
        } else if (act === 'find-libs') {
          busy(true); say('正在寻找动作库…');
          const r = await ctx.invoke('find-libraries', []);
          renderLibraries(r.libraries || []);
          say(r.count
            ? `找到 ${r.count} 个候选，点一个就用它`
            : '没找到像动作库的目录 —— 用「动作库」菜单里的「选择动作库位置…」手动指，或用「添加更多动作…」先建一个', !r.count);
        } else if (act === 'starter-library') {
          let parent = null;
          try {
            parent = await ctx.pickPath({ kind: 'directory', title: '选一个盘或文件夹，自带示例动作库会建在它下面的「深深-动作库」里' });
          } catch { parent = null; }
          if (!parent) return say('没有选目录', true);
          busy(true); say('正在建动作库…');
          const r = await ctx.invoke('use-starter-library', [parent]);
          say((r.created ? '已建好：' : '这个位置已有动作库，直接用：') + r.path);
          await loadAll();
        } else if (act === 'use-lib') {
          const dir = btn.dataset.dir;
          if (!dir) return;
          busy(true);
          await ctx.invoke('set-library', [dir]);
          renderLibraries([]);
          await loadAll();
          say('动作库已切到 ' + dir);
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
        } else if (act === 'library') {
          // 协议里 PathPickerOptions.kind 只有 'file' | 'directory'
          const dir = await ctx.pickPath({ kind: 'directory', title: '选择动作库目录（里面要有 actions/）' });
          if (!dir) return say('没有选目录', true);
          busy(true);
          const r = await ctx.invoke('set-library', [dir]);
          await loadAll();
          say(r.note ? `${r.note}（${r.libraryDir}）` : `动作库已更新（${r.libraryDir}）`);
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
