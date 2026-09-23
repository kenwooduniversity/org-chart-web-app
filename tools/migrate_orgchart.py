"""Builds public/orgchart/index.html (Firebase version) from
legacy/orgchart-claude-artifact.html (Claude artifact version).

Every edit asserts it matched exactly the expected number of times, so if the
legacy file changes this fails loudly instead of producing a half-migrated page.
Run from the repo root:  python3 tools/migrate_orgchart.py
"""
import pathlib, sys

root = pathlib.Path(__file__).resolve().parent.parent
src = (root / "legacy/orgchart-claude-artifact.html").read_text(encoding="utf-8")
s = src


def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        sys.exit(f"expected {count} match(es), found {n}: {old[:80]!r}")
    s = s.replace(old, new)


def cut(start_marker, end_marker, new=""):
    """Replace everything from start_marker up to (not including) end_marker."""
    global s
    a = s.find(start_marker)
    b = s.find(end_marker, a)
    if a < 0 or b < 0 or s.count(start_marker) != 1:
        sys.exit(f"cut markers not found/unique: {start_marker[:60]!r} .. {end_marker[:60]!r}")
    s = s[:a] + new + s[b:]


# ---------------------------------------------------------------- document shell
rep('<title>Kenwood Org Chart</title>\n',
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
    '<title>Org Chart · Kenwood</title>\n<link rel="stylesheet" href="../assets/platform.css">\n')
rep('</style>\n\n<header>', '</style>\n</head>\n<body>\n<header>')
s = s.rstrip("\n") + "\n</body>\n</html>\n"

# ---------------------------------------------------------------- header: backup/import button
rep('    <button class="btn" id="btnExportPdf">Export PDF</button>\n',
    '    <button class="btn" id="btnExportPdf">Export PDF</button>\n'
    '    <button class="btn" id="btnData">Backup</button>\n')
rep('      <button class="btn primary" id="btnAddFirst">+ Add first position</button>\n',
    '      <button class="btn primary" id="btnAddFirst">+ Add first position</button>\n'
    '      <button class="btn" id="btnImportFirst" style="display:none;">Import from a backup file</button>\n')
rep('<div class="toast" id="toast"></div>\n',
    '<div class="toast" id="toast"></div>\n'
    '<input type="file" id="importFile" accept="application/json,.json" style="display:none;">\n')

# ---------------------------------------------------------------- script becomes a module using the platform shell
rep('<script>\n(function(){\n"use strict";\n',
    '<script type="module">\n'
    'import { startPage, db as fdb, fs, rank } from "../assets/platform.js";\n'
    '(function(){\n"use strict";\n')
rep('  scale: 1,\n  dbReady:false\n};',
    '  scale: 1,\n  dbReady:false,\n  headshots: {},    // id -> data: URL thumbnail (stored in Firestore)\n  role: "viewer"\n};')

# ---------------------------------------------------------------- capability init -> Firebase
FIREBASE_INIT = r'''async function initCapabilities(){
  var ctx;
  try{ ctx = await startPage({moduleId:"orgchart", title:"Org Chart"}); }
  catch(e){ return; } // the platform shell is showing a sign-in / no-access screen
  db = makeDb("orgchart/main");
  assetsCap = { upload: uploadHeadshot };
  downloadsCap = { save: saveDownload };
  state.dbReady = true;
  state.role = ctx.role;
  state.userEmail = ctx.email;
  subscribeAll();
  setReadOnly(rank(ctx.role) < rank("editor"));
  var imp=document.getElementById("btnImportFirst");
  if(imp) imp.style.display = rank(ctx.role) >= rank("admin") ? "inline-flex" : "none";
}

/* ---------------- Firestore adapter ----------------
   Keeps the same small API the page was written against (db.doc(path).set/update/…,
   db.collection(name).orderBy().limit().onSnapshot) but stores everything under
   orgchart/main in Firestore. "meta/config" maps to the orgchart/main doc itself. */
function makeDb(base){
  function refFor(path){ return path==="meta/config" ? fs.doc(fdb, base) : fs.doc(fdb, base+"/"+path); }
  function wrapDoc(snap){ return {id:snap.id, exists:snap.exists(), data:function(){ return snap.data(); }}; }
  function wrapQuery(snap){ return {docs:snap.docs.map(function(d){ return {id:d.id, data:function(){ return d.data(); }}; })}; }
  function docApi(path){
    var r = refFor(path), isConfig = path==="meta/config";
    return {
      get: function(){ return fs.getDoc(r).then(wrapDoc); },
      set: function(data){ return fs.setDoc(r, data); },
      update: function(data){ return isConfig ? fs.setDoc(r, data, {merge:true}) : fs.updateDoc(r, data); },
      delete: function(){ return fs.deleteDoc(r); },
      onSnapshot: function(cb, err){ return fs.onSnapshot(r, function(s){ cb(wrapDoc(s)); }, err); }
    };
  }
  function collApi(name, constraints){
    var c = fs.collection(fdb, base+"/"+name);
    var q = function(){ return fs.query.apply(null, [c].concat(constraints)); };
    return {
      orderBy: function(field, dir){ return collApi(name, constraints.concat([fs.orderBy(field, dir)])); },
      limit: function(n){ return collApi(name, constraints.concat([fs.limit(n)])); },
      get: function(){ return fs.getDocs(q()).then(wrapQuery); },
      onSnapshot: function(cb, err){ return fs.onSnapshot(q(), function(s){ cb(wrapQuery(s)); }, err); }
    };
  }
  return { doc: docApi, collection: function(name){ return collApi(name, []); } };
}

/* headshots are resized in the browser and stored as small JPEG data URLs in
   orgchart/main/headshots/{id} (no Cloud Storage bucket needed on the free plan) */
var HEADSHOT_MAX = 320;
function fileToThumb(file){
  return new Promise(function(resolve, reject){
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function(){
      URL.revokeObjectURL(url);
      var sc = Math.min(1, HEADSHOT_MAX/Math.max(img.naturalWidth, img.naturalHeight));
      var w = Math.max(1, Math.round(img.naturalWidth*sc)), h = Math.max(1, Math.round(img.naturalHeight*sc));
      var cv = document.createElement("canvas"); cv.width=w; cv.height=h;
      var cx = cv.getContext("2d"); cx.fillStyle="#fff"; cx.fillRect(0,0,w,h); cx.drawImage(img,0,0,w,h);
      var q = 0.85, out = cv.toDataURL("image/jpeg", q);
      while(out.length > 350000 && q > 0.4){ q -= 0.15; out = cv.toDataURL("image/jpeg", q); }
      resolve(out);
    };
    img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error("That file isn't an image this browser can read.")); };
    img.src = url;
  });
}
function uploadHeadshot(file){
  var id = uid("img");
  return fileToThumb(file).then(function(dataUrl){
    return fs.setDoc(fs.doc(fdb, "orgchart/main/headshots/"+id), {dataUrl:dataUrl, createdAt:Date.now(), createdBy:state.userEmail||null});
  }).then(function(){ return {id:id}; });
}
var BLANK_PX = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
function headshotSrc(id){ return (id && state.headshots[id]) || BLANK_PX; }

function saveDownload(opts){
  var url = URL.createObjectURL(opts.data), a = document.createElement("a");
  a.href = url; a.download = opts.filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
  return Promise.resolve();
}

'''
cut('async function initCapabilities(){', 'function setReadOnly(ro){', FIREBASE_INIT)
# the platform top bar already shows the person's role; only keep the in-page "View only" hint
rep('  b.style.display="inline-flex";\n', '  b.style.display = ro ? "inline-flex" : "none";\n')

# ---------------------------------------------------------------- subscriptions
rep('    if(Object.keys(map).length===0 && !state.readOnly && state.roleKnown){ seedIfEmpty(); }\n', '')
rep('''  db.collection("versions").orderBy("createdAt","desc").limit(30).onSnapshot(''',
    '''  db.collection("headshots").onSnapshot(function(snap){
    var map={};
    snap.docs.forEach(function(d){ map[d.id]=d.data().dataUrl; });
    state.headshots = map;
    renderPeopleModalIfOpen();
    if(state.selectedId) refreshOpenProfilePersonBits();
    render();
  }, function(err){ console.warn("headshots sub error", err); });

  db.collection("versions").orderBy("createdAt","desc").limit(30).onSnapshot(''')

# the hard-coded seed chart is replaced by importing the real data from a backup file
cut('var seedAttempted=false;', '/* one-time migration:')
cut('/* ---------------- default seed data (Kenwood) ---------------- */', '/* ---------------- view options ---------------- */')

# don't flash "No positions yet" while the chart is still loading from Firestore
rep('  empty.style.display = hasAny ? "none":"flex";\n',
    '  empty.style.display = (hasAny || !positionsLoaded) ? "none":"flex";\n')

# ---------------------------------------------------------------- headshot rendering
rep('''<img src="/_blob/'+person.headshotId+'"''', '''<img src="'+headshotSrc(person.headshotId)+'"''', count=3)
if "/_blob/" in s:
    sys.exit("unmigrated /_blob/ reference left")

# ---------------------------------------------------------------- permission errors from Firestore
rep('if(err && err.code==="invalid_argument"){ setReadOnly(true);',
    'if(err && (err.code==="permission-denied" || err.code==="invalid_argument")){ setReadOnly(true);')

# ---------------------------------------------------------------- backup / import
BACKUP = r'''/* ---------------- backup (export / import JSON) ----------------
   Same format as the export made from the original Claude version, so the real
   chart can be moved over with "Import". Import replaces the whole chart. */
var BACKUP_FORMAT = "kenwood-orgchart-export";
function stripId(o){ var c={}; Object.keys(o).forEach(function(k){ if(k!=="id") c[k]=o[k]; }); return c; }
function byIdStripped(m){ var out={}; Object.keys(m).forEach(function(k){ out[k]=stripId(m[k]); }); return out; }
function exportBackup(){
  var shots={}; Object.keys(state.headshots).forEach(function(k){ shots[k]={dataUrl:state.headshots[k]}; });
  var out = {format:BACKUP_FORMAT, version:1, exportedAt:new Date().toISOString(),
    config:{orgTitle:state.config.orgTitle||"Organization Chart"},
    departments:byIdStripped(state.departments), people:byIdStripped(state.people),
    positions:JSON.parse(JSON.stringify(state.positions)), headshots:shots};
  var name = (state.config.orgTitle||"org-chart").replace(/[^\w\- ]/g,"")+" backup "+new Date().toISOString().slice(0,10)+".json";
  saveDownload({filename:name, data:new Blob([JSON.stringify(out)], {type:"application/json"})});
  toast("Backup downloaded.");
}
function importBackup(file){
  var reader = new FileReader();
  reader.onload = function(){
    var data;
    try{ data = JSON.parse(reader.result); }catch(e){ toast("That file isn't valid JSON."); return; }
    if(!data || data.format!==BACKUP_FORMAT || !data.positions){ toast("That file isn't an org chart backup."); return; }
    var nPos=Object.keys(data.positions).length, nPeople=Object.keys(data.people||{}).length, nDept=Object.keys(data.departments||{}).length, nImg=Object.keys(data.headshots||{}).length;
    var hasCurrent = Object.keys(state.positions).length>0;
    showConfirm("Import "+nPos+" positions, "+nPeople+" people, "+nDept+" departments and "+nImg+" photos?"+
      (hasCurrent? " This replaces the current chart. Tip: download a backup first." : ""),
      {title:"Import org chart", okLabel:"Import", danger:hasCurrent}).then(function(ok){
      if(!ok) return;
      var ops=[];
      function put(coll, id, doc){ ops.push({ref:fs.doc(fdb,"orgchart/main/"+coll+"/"+id), data:doc}); }
      function del(coll, id){ ops.push({ref:fs.doc(fdb,"orgchart/main/"+coll+"/"+id), del:true}); }
      Object.keys(data.headshots||{}).forEach(function(id){ put("headshots", id, {dataUrl:data.headshots[id].dataUrl, createdAt:Date.now(), createdBy:state.userEmail||null}); });
      Object.keys(data.departments||{}).forEach(function(id){ put("departments", id, stripId(data.departments[id])); });
      Object.keys(data.people||{}).forEach(function(id){ put("people", id, stripId(data.people[id])); });
      Object.keys(data.positions).forEach(function(id){ var p=Object.assign({}, data.positions[id], {id:id}); put("positions", id, p); });
      Object.keys(state.positions).forEach(function(id){ if(!data.positions[id]) del("positions", id); });
      Object.keys(state.people).forEach(function(id){ if(!(data.people||{})[id]) del("people", id); });
      Object.keys(state.departments).forEach(function(id){ if(!(data.departments||{})[id]) del("departments", id); });
      ops.push({ref:fs.doc(fdb,"orgchart/main"), data:{orgTitle:(data.config&&data.config.orgTitle)||"Organization Chart"}, merge:true});
      var chunks=[]; for(var i=0;i<ops.length;i+=400) chunks.push(ops.slice(i,i+400));
      toast("Importing…");
      chunks.reduce(function(p, chunk){
        return p.then(function(){
          var b = fs.writeBatch(fdb);
          chunk.forEach(function(op){ if(op.del) b.delete(op.ref); else if(op.merge) b.set(op.ref, op.data, {merge:true}); else b.set(op.ref, op.data); });
          return b.commit();
        });
      }, Promise.resolve()).then(function(){
        hasAutoScrolled=false; toast("Imported "+nPos+" positions.");
      }).catch(function(err){
        console.warn(err);
        toast(err && err.code==="permission-denied" ? "You need editor access to import." : "Import failed — "+((err&&err.message)||err));
      });
    });
  };
  reader.readAsText(file);
}
function openBackupModal(){
  var canImport = rank(state.role) >= rank("admin");
  var html =
    '<div class="overlay" id="backupOverlay"><div class="modal" style="width:440px;">'+
    '<div class="modal-hd"><h3>Backup</h3><button class="close-x" id="backupClose">✕</button></div>'+
    '<div class="modal-body"><p style="margin:0 0 14px;font-size:13px;line-height:1.5;">Download the whole chart (positions, people, departments and photos) as a file you can keep or restore later.</p>'+
    '<button class="btn primary" id="backupDownload">Download backup</button>'+
    (canImport? '<p style="margin:18px 0 10px;font-size:13px;line-height:1.5;">Import replaces the current chart with the contents of a backup file.</p><button class="btn" id="backupImport">Import from file…</button>' : '')+
    '</div></div></div>';
  document.body.insertAdjacentHTML("beforeend", html);
  var close=function(){ var o=document.getElementById("backupOverlay"); if(o) o.remove(); };
  document.getElementById("backupOverlay").addEventListener("click", function(e){ if(e.target.id==="backupOverlay") close(); });
  document.getElementById("backupClose").addEventListener("click", close);
  document.getElementById("backupDownload").addEventListener("click", function(){ exportBackup(); close(); });
  var ib=document.getElementById("backupImport");
  if(ib) ib.addEventListener("click", function(){ close(); document.getElementById("importFile").click(); });
}
document.getElementById("importFile").addEventListener("change", function(e){
  var f=e.target.files[0]; e.target.value=""; if(f) importBackup(f);
});

/* ---------------- zoom / search / header wiring ---------------- */'''
rep('/* ---------------- zoom / search / header wiring ---------------- */', BACKUP)
rep('document.getElementById("btnExportPdf").addEventListener("click", exportPdf);\n',
    'document.getElementById("btnExportPdf").addEventListener("click", exportPdf);\n'
    'document.getElementById("btnData").addEventListener("click", openBackupModal);\n'
    'document.getElementById("btnImportFirst").addEventListener("click", function(){ document.getElementById("importFile").click(); });\n')

# ---------------------------------------------------------------- sanity
for bad in ('claude.use', '/_blob/', 'seedDefaultChart', 'probeWriteAccess'):
    if bad in s:
        sys.exit(f"leftover reference: {bad}")

out = root / "public/orgchart/index.html"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(s, encoding="utf-8")
print(f"wrote {out.relative_to(root)} ({len(s.encode())} bytes)")
