/* =========================================================================
   KPI consulting — нийтлэг Firebase backend (store + auth)
   -------------------------------------------------------------------------
   index.html болон admin.html хоёуланд ашиглагдана.

   Өгөгдлийн бүтэц (Firestore):
   1) content/{key}          — нийтийн контент (нийтлэл, темплэйт, холбоо барих,
                               "Яагаад бид", цагийн хуваарь, асуулга).
                               Дүрэм: хэн ч унших, зөвхөн нэвтэрсэн админ бичих.
   2) submissions/{autoId}   — зочны илгээлт: { kind:'quote'|'booking'|'user', ... }.
                               Хувийн мэдээлэл агуулна. Дүрэм: зочид зөвхөн create,
                               зөвхөн админ унших/устгах.
   3) public/taken_slots     — захиалагдсан цагийн жагсаалт (PII биш, огноо+цаг).
                               Зочдод "энэ цаг завгүй" гэдгийг харуулахад.

   Нэвтрэлт: admin.html нь Firebase Authentication (и-мэйл/нууц үг)-ээр нэвтэрнэ.

   Firestore/Auth холбогдохгүй үед нийтийн сайт localStorage руу шилжиж
   хэвийн ажиллана (админ хэсэг нь Auth шаарддаг тул онлайн байх ёстой).
   ========================================================================= */
(function () {
  "use strict";

  var firebaseConfig = {
    apiKey: "AIzaSyBvjR_5pAAksA4UcQeRyzt6bEL1yk717Pw",
    authDomain: "kpiconsulting.firebaseapp.com",
    projectId: "kpiconsulting",
    storageBucket: "kpiconsulting.firebasestorage.app",
    messagingSenderId: "964614375498",
    appId: "1:964614375498:web:48dc9390b4477c13d03eb3",
    measurementId: "G-XGP7V1Y0EG"
  };

  // Нийтийн контентын түлхүүрүүд (content коллекц дотор доκ тус бүр)
  var CONTENT_KEYS = [
    "kpihub_templates",
    "kpihub_articles",
    "kpihub_contact",
    "kpihub_why",
    "kpihub_availability",
    "kpihub_quote_questions"
  ];
  var LOCAL_SUBS = "kpihub_local_submissions"; // офлайн үед зочны илгээлтийг түр хадгалах

  var cache = {};
  var takenSet = {};   // "YYYY-MM-DD HH:MM" -> true
  var db = null, auth = null, online = false;
  var noop = function () {};

  // ---- Firebase эхлүүлэх ----
  try {
    if (typeof firebase !== "undefined" && firebase.initializeApp) {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(firebaseConfig);
      db = firebase.firestore();
      if (firebase.auth) auth = firebase.auth();
      online = true;
      try { if (firebase.analytics && location.protocol === "https:") firebase.analytics(); } catch (e) {}
    }
  } catch (e) {
    console.warn("[KPICloud] Firebase эхлүүлж чадсангүй — localStorage горим.", e);
    online = false;
  }

  // ================= Нийтийн контент (content/{key}) =================
  function mirror(key, value) {
    cache[key] = value;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function get(key, def) {
    if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
    try { var r = localStorage.getItem(key); if (r !== null && r !== undefined) return JSON.parse(r); } catch (e) {}
    return def;
  }
  // Админ засвар (нэвтэрсэн байх шаардлагатай)
  // ЧУХАЛ: энэ функц синхроноор алдаа ШИДЭХГҮЙ. Firestore SDK нь баримт хэт том
  // (1MiB-с их) үед .set()-ийг дуудмагц шууд throw хийдэг байсан тул дуудагч
  // талын дараагийн мөрүүд (жишээ нь дэлгэц дахин зурах) алгасагдаж, устгасан
  // мөр дэлгэц дээр үлдэж байв. Одоо бүх алдаа promise-ээр буцна.
  function set(key, value) {
    mirror(key, value);
    if (!online) return Promise.resolve(value);
    function fail(err) {
      console.error("[KPICloud] content хадгалж чадсангүй:", key, err);
      return Promise.reject(err);
    }
    try {
      return db.collection("content").doc(key)
        .set({ value: value, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
        .then(function () { return value; })
        .catch(fail);
    } catch (err) {
      return fail(err);
    }
  }
  function watch(key, cb) {
    if (!online) return noop;
    return db.collection("content").doc(key).onSnapshot(function (snap) {
      if (snap.exists && snap.data() && Object.prototype.hasOwnProperty.call(snap.data(), "value")) {
        mirror(key, snap.data().value);
        if (cb) cb(cache[key]);
      }
    }, function (err) { console.error("[KPICloud] content watch алдаа:", key, err); });
  }

  // ================= Зочны илгээлт (submissions/{autoId}) =================
  function localSubs() {
    try { var r = localStorage.getItem(LOCAL_SUBS); return r ? JSON.parse(r) : []; } catch (e) { return []; }
  }
  function writeLocalSubs(arr) { try { localStorage.setItem(LOCAL_SUBS, JSON.stringify(arr)); } catch (e) {} }
  function dropLocalSub(lid) { writeLocalSubs(localSubs().filter(function (s) { return s._lid !== lid; })); }
  function makeLid() { return Date.now() + "-" + Math.floor(Math.random() * 1e9); }

  // Илгээлтийг ЭХЛЭЭД локал буферт хадгална (алдагдахгүй), дараа нь Firestore-д.
  // Амжилттай бол буфероос хасна. Офлайн/алдаа гарвал буферт үлдэж, дараагийн
  // ачаалалд flushLocalSubs() автоматаар дахин илгээнэ. Ингэснээр сүлжээ тасарсан
  // ч зочны хүсэлт/захиалга алдагдахгүй.
  function addSubmission(kind, data) {
    var lid = makeLid();
    var entry = Object.assign({ kind: kind, at: new Date().toISOString() }, data || {});
    var buf = localSubs(); buf.push(Object.assign({ _lid: lid }, entry)); writeLocalSubs(buf);
    if (!online) return Promise.resolve(entry);
    return db.collection("submissions").add(entry)
      .then(function (ref) { dropLocalSub(lid); return Object.assign({ id: ref.id }, entry); })
      .catch(function (err) {
        console.error("[KPICloud] илгээлт хойшлов (дараа дахин оролдоно):", err);
        return entry; // буферт үлдэнэ
      });
  }
  // Өмнөх ачаалалд буферт үлдсэн (илгээгдээгүй) илгээлтүүдийг дахин илгээх
  function flushLocalSubs() {
    if (!online) return;
    localSubs().forEach(function (item) {
      var lid = item._lid;
      var doc = Object.assign({}, item); delete doc._lid;
      db.collection("submissions").add(doc)
        .then(function () { dropLocalSub(lid); })
        .catch(function () {}); // дараагийн удаа дахин оролдоно
    });
  }
  // Зөвхөн админ (нэвтэрсэн) — тодорхой төрлийн илгээлтийг бодит цагт сонсох
  function watchSubmissions(kind, cb) {
    if (!online) { if (cb) cb(localSubs().filter(function (s) { return s.kind === kind; })); return noop; }
    return db.collection("submissions").where("kind", "==", kind)
      .onSnapshot(function (snap) {
        var arr = [];
        snap.forEach(function (d) { arr.push(Object.assign({ id: d.id }, d.data())); });
        arr.sort(function (a, b) { return String(a.at || "").localeCompare(String(b.at || "")); });
        if (cb) cb(arr);
      }, function (err) { console.error("[KPICloud] submissions watch алдаа:", kind, err); });
  }
  function deleteSubmission(id) {
    if (!online || !id) return Promise.resolve();
    return db.collection("submissions").doc(id).delete()
      .catch(function (err) {
        console.error("[KPICloud] илгээлт устгаж чадсангүй:", id, err);
        throw err;
      });
  }
  function addCrmActivity(data) {
    if (!online || !auth || !auth.currentUser) return Promise.reject(new Error("Эхлээд админаар нэвтэрнэ үү"));
    var admin = auth.currentUser;
    var entry = Object.assign({
      kind: "crm",
      at: new Date().toISOString(),
      byName: admin.displayName || "",
      byEmail: admin.email || ""
    }, data || {});
    return db.collection("submissions").add(entry)
      .then(function (ref) { return Object.assign({ id: ref.id }, entry); });
  }

  // ================= Захиалагдсан цаг (public/taken_slots) =================
  function slotKey(date, time) { return date + " " + time; }
  function isTaken(date, time) { return !!takenSet[slotKey(date, time)]; }
  function takenList() { return Object.keys(takenSet); }
  function addTakenSlot(date, time) {
    var k = slotKey(date, time); takenSet[k] = true;
    if (!online) return Promise.resolve();
    return db.collection("public").doc("taken_slots")
      .set({ slots: firebase.firestore.FieldValue.arrayUnion(k) }, { merge: true })
      .catch(function (err) { console.error("[KPICloud] taken slot нэмж чадсангүй:", err); });
  }
  function removeTakenSlot(date, time) {
    var k = slotKey(date, time); delete takenSet[k];
    if (!online) return Promise.resolve();
    return db.collection("public").doc("taken_slots")
      .set({ slots: firebase.firestore.FieldValue.arrayRemove(k) }, { merge: true })
      .catch(function (err) { console.error("[KPICloud] taken slot устгаж чадсангүй:", err); });
  }
  function watchTaken(cb) {
    if (!online) { if (cb) cb(); return noop; }
    return db.collection("public").doc("taken_slots").onSnapshot(function (snap) {
      takenSet = {};
      if (snap.exists && snap.data() && Array.isArray(snap.data().slots)) {
        snap.data().slots.forEach(function (k) { takenSet[k] = true; });
      }
      if (cb) cb();
    }, function (err) { console.error("[KPICloud] taken watch алдаа:", err); });
  }

  // ================= Authentication (админ) =================
  function signIn(email, password) {
    if (!auth) return Promise.reject(new Error("Auth бэлэн биш"));
    return auth.signInWithEmailAndPassword(email, password);
  }
  function signOut() { return auth ? auth.signOut() : Promise.resolve(); }
  function onAuth(cb) {
    if (!auth) { if (cb) cb(null); return noop; }
    return auth.onAuthStateChanged(cb);
  }
  function authUser() { return auth ? auth.currentUser : null; }
  // Нэвтэрсэн хэрэглэгч админ мөн эсэх (admins/{uid}-г уншиж чадах эсэхээр).
  // true = админ, false = админ БИШ (эрх татгалзсан), null = тодорхойгүй (сүлжээ).
  function checkAdmin() {
    if (!online || !auth || !auth.currentUser) return Promise.resolve(null);
    return db.collection("admins").doc(auth.currentUser.uid).get()
      .then(function (snap) { return snap.exists; })
      .catch(function (err) { return (err && err.code === "permission-denied") ? false : null; });
  }
  function createAdmin(email, password, name) {
    if (!online || !auth || !db) return Promise.reject(new Error("Firebase бэлэн биш"));
    if (!auth.currentUser) return Promise.reject(new Error("Эхлээд админаар нэвтэрнэ үү"));

    var appName = "kpi-admin-create-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
    var secondaryApp = firebase.initializeApp(firebaseConfig, appName);
    var secondaryAuth = secondaryApp.auth();
    var createdUser = null;
    var createdBy = auth.currentUser.uid;

    function cleanup() {
      return secondaryAuth.signOut().catch(function () {})
        .then(function () { return secondaryApp.delete ? secondaryApp.delete() : null; })
        .catch(function () {});
    }

    return secondaryAuth.createUserWithEmailAndPassword(email, password)
      .then(function (cred) {
        createdUser = cred.user;
        if (createdUser && name && createdUser.updateProfile) {
          return createdUser.updateProfile({ displayName: name }).then(function () { return cred; });
        }
        return cred;
      })
      .then(function (cred) {
        var user = cred.user;
        return db.collection("admins").doc(user.uid).set({
          ok: true,
          email: email,
          name: name || "",
          createdBy: createdBy,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(function () {
          return { uid: user.uid, email: email, name: name || "" };
        });
      })
      .catch(function (err) {
        if (!createdUser || !createdUser.delete) throw err;
        return createdUser.delete().catch(function () {}).then(function () { throw err; });
      })
      .finally(cleanup);
  }
  function watchAdmins(cb) {
    if (!online) { if (cb) cb([]); return noop; }
    return db.collection("admins").onSnapshot(function (snap) {
      var arr = [];
      snap.forEach(function (d) { arr.push(Object.assign({ uid: d.id }, d.data())); });
      arr.sort(function (a, b) { return String(a.email || a.uid || "").localeCompare(String(b.email || b.uid || "")); });
      if (cb) cb(arr);
    }, function (err) { console.error("[KPICloud] admins watch алдаа:", err); });
  }
  function removeAdmin(uid) {
    if (!online || !uid) return Promise.resolve();
    if (auth && auth.currentUser && auth.currentUser.uid === uid) {
      return Promise.reject(new Error("Өөрийн админ эрхийг эндээс устгахгүй."));
    }
    return db.collection("admins").doc(uid).delete();
  }

  // ================= Эхний ачаалал =================
  var ready;
  if (online) {
    var failed = 0;
    var jobs = CONTENT_KEYS.map(function (key) {
      return db.collection("content").doc(key).get()
        .then(function (snap) {
          if (snap.exists && snap.data() && Object.prototype.hasOwnProperty.call(snap.data(), "value")) mirror(key, snap.data().value);
        })
        .catch(function () { failed++; });
    });
    jobs.push(
      db.collection("public").doc("taken_slots").get()
        .then(function (snap) {
          if (snap.exists && snap.data() && Array.isArray(snap.data().slots)) {
            snap.data().slots.forEach(function (k) { takenSet[k] = true; });
          }
        })
        .catch(function () {})
    );
    ready = Promise.all(jobs).then(function () {
      if (failed >= CONTENT_KEYS.length) {
        console.warn("[KPICloud] Firestore-той холбогдож чадсангүй — localStorage горимд ажиллаж байна. " +
          "Firebase консол дээр Firestore Database үүсгэж, дүрмээ тохируулна уу.");
      } else if (failed > 0) {
        console.warn("[KPICloud] " + failed + " контент ачаалагдсангүй, локал хувилбар ашиглав.");
      } else {
        flushLocalSubs(); // өмнө нь илгээгдээгүй үлдсэн хүсэлт/захиалгыг дахин илгээх
      }
      return failed < CONTENT_KEYS.length;
    });
  } else {
    ready = Promise.resolve(false);
  }

  window.KPICloud = {
    // content
    get: get, set: set, watch: watch,
    // submissions
    addSubmission: addSubmission, watchSubmissions: watchSubmissions, deleteSubmission: deleteSubmission,
    addCrmActivity: addCrmActivity,
    // taken slots
    isTaken: isTaken, takenList: takenList, addTakenSlot: addTakenSlot, removeTakenSlot: removeTakenSlot, watchTaken: watchTaken,
    // auth
    signIn: signIn, signOut: signOut, onAuth: onAuth, authUser: authUser, checkAdmin: checkAdmin,
    createAdmin: createAdmin, watchAdmins: watchAdmins, removeAdmin: removeAdmin,
    // misc
    ready: ready, online: online, db: db, auth: auth, CONTENT_KEYS: CONTENT_KEYS
  };
})();
