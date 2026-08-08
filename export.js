// Export daily snapshots into public/data for static hosting (GitHub Pages).
const fs=require('fs'),path=require('path'),store=require('./store'),market=require('./market');
const OUT=path.join(__dirname,'public','data'),SNAP=path.join(OUT,'snapshots');
function run(){
  fs.mkdirSync(SNAP,{recursive:true});
  var dates=store.listDates(),history=store.getHistory();
  fs.writeFileSync(path.join(OUT,'history.json'),JSON.stringify(history));
  fs.writeFileSync(path.join(OUT,'dates.json'),JSON.stringify(dates));
  for(var i=0;i<dates.length;i++){var s=store.loadSnapshot(dates[i]);fs.writeFileSync(path.join(SNAP,dates[i]+'.json'),JSON.stringify(s))}
  var topN=8,series={},topAuthors=[];
  for(var j=0;j<dates.length;j++){
    var snap=store.loadSnapshot(dates[j]);if(!snap)continue;
    if(!topAuthors.length&&snap.authors)topAuthors=snap.authors.slice(0,topN).map(function(a){return a.author});
    if(snap.authors)for(var k=0;k<snap.authors.length;k++){var a2=snap.authors[k];if(topAuthors.indexOf(a2.author)<0)continue;if(!series[a2.author])series[a2.author]=[];series[a2.author].push({date:dates[j],cost:a2.cost,tokens:a2.totalTokens,share:a2.costShare})}
  }
  fs.writeFileSync(path.join(OUT,'author-history.json'),JSON.stringify({dates:dates,authors:topAuthors,series:series}));
  fs.writeFileSync(path.join(OUT,'market.json'),JSON.stringify(market.getMarket()));
  console.log('Exported '+dates.length+' snapshots');
}
if(require.main===module)run();
module.exports={run:run};
