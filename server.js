// Zero-dependency HTTP server: dashboard + JSON API + daily scheduler.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const scraper = require('./scraper');
const store = require('./store');
const market = require('./market');
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml' };
function sendJSON(res, code, obj) { var body=JSON.stringify(obj); res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'}); res.end(body); }
function serveStatic(req, res, pathname) {
  var rel = pathname === '/' ? '/index.html' : pathname;
  var filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, function(err, data) { if (err) { res.writeHead(404); res.end('Not found'); return; } res.writeHead(200, {'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream'}); res.end(data); });
}
const server = http.createServer(async function(req, res) {
  var u = new URL(req.url, 'http://localhost:'+PORT); var p = u.searchParams;
  try {
    if (u.pathname === '/api/history') return sendJSON(res, 200, store.getHistory(p.get('days') || 3650));
    if (u.pathname === '/api/latest') return sendJSON(res, 200, store.getLatest());
    if (u.pathname === '/api/snapshot') { var date=p.get('date')||store.todayUTC(); var snap=store.loadSnapshot(date); return sendJSON(res, snap?200:404, snap||{error:'no snapshot',date:date}); }
    if (u.pathname === '/api/dates') return sendJSON(res, 200, store.listDates());
    if (u.pathname === '/api/market') return sendJSON(res, 200, market.getMarket());
    if (u.pathname === '/api/author-history') {
      var topN=Number(p.get('top')||8), dates=store.listDates(), series={};
      for (var i=0;i<dates.length;i++){var d=dates[i],s=store.loadSnapshot(d);if(!s||!s.authors)continue;for(var j=0;j<s.authors.length&&j<topN*2;j++){var a=s.authors[j];if(!series[a.author])series[a.author]=[];series[a.author].push({date:d,cost:a.cost,tokens:a.totalTokens,share:a.costShare})}}
      var latest=store.getLatest(); var topAuthors=(latest&&latest.authors?latest.authors:[]).slice(0,topN).map(function(x){return x.author});
      var result={}; for(var k=0;k<topAuthors.length;k++)result[topAuthors[k]]=series[topAuthors[k]]||[];
      return sendJSON(res,200,{dates:dates,authors:topAuthors,series:result});
    }
    if (u.pathname === '/api/scrape' && req.method === 'POST') { var snap=await scraper.run(); return sendJSON(res,200,snap); }
    if (u.pathname === '/api/health') return sendJSON(res,200,{ok:true,time:new Date().toISOString(),dates:store.listDates().length});
    return serveStatic(req, res, u.pathname);
  } catch(e) { return sendJSON(res,500,{error:e.message}); }
});
var timer=null,scraping=false;
async function tick(){if(scraping)return;scraping=true;try{await scraper.run()}catch(e){console.error('Scheduled scrape failed:',e.message)}finally{scraping=false;scheduleNext()}}
function scheduleNext(){if(timer)clearTimeout(timer);var now=new Date(),next=new Date(now);next.setUTCHours(23,55,0,0);if(next<=now)next.setUTCDate(next.getUTCDate()+1);timer=setTimeout(tick,next-now);console.log('Next scrape at '+next.toISOString())}
store.ensureDirs();
server.listen(PORT,function(){console.log('OR Dashboard at http://localhost:'+PORT);tick()});
