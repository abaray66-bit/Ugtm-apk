/* cloud.js - connexion Google et donnees partagees (Firebase).
   Ce module n'est charge que si "firebase" est renseigne dans data.js.
   S'il ne peut pas se charger (hors connexion...), l'application continue de fonctionner avec data.js. */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithCredential,
  reauthenticateWithPopup, onAuthStateChanged, signOut as fbSignOut, deleteUser
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
  onSnapshot, query, where, serverTimestamp, arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

var auth, db, hooks;
var nativeAuth = null;

var unsubs = {
  member: null,
  members: null,
  news: null,
  dossiers: null,
  reunions: null,
  locaux: null
};

var newsMode = null;

var session = {
  user: null,
  member: null,
  isAdmin: false,
  isRespProv: false,
  isRespLocal: false
};

function ms(v){
  return (v && typeof v.toMillis === 'function') ? v.toMillis() : null;
}

function isResp(){
  return session.isRespProv || session.isRespLocal;
}

function normalizeMember(d, uid){
  return {
    uid: uid,
    name: d.name || '',
    email: d.email || '',
    photo: d.photo || '',
    etab: d.etab || '',
    prov: d.prov || '',
    local: d.local || '',
    phone: d.phone || '',
    status: d.status || 'pending',
    memberNo: d.memberNo || '',
    role: d.role || 'member',
    adminProvince: d.adminProvince || '',
    adminLocal: d.adminLocal || '',
    createdAt: ms(d.createdAt),
    activatedAt: ms(d.activatedAt)
  };
}

function unsub(key){
  if (unsubs[key]){
    unsubs[key]();
    unsubs[key] = null;
  }
}

/* =========================================================
   COMMUNIQUES
   ========================================================= */

function subscribeNews(){
  var mode = (session.isAdmin || (session.member && session.member.status === 'active')) ? 'all' : 'public';
  if (mode === newsMode && unsubs.news) return;
  newsMode = mode;
  unsub('news');

  var q = mode === 'all'
    ? collection(db, 'news')
    : query(collection(db, 'news'), where('audience', '==', 'public'));

  unsubs.news = onSnapshot(q, function(snap){
    hooks.setNews(snap.docs.map(function(d){
      var x = d.data();
      return {
        id: d.id, cat: x.cat, audience: x.audience, province: x.province || '', local: x.local || '',
        date: x.date, image: x.image || '', fr: x.fr, ar: x.ar
      };
    }));
  }, function(err){ hooks.error(err, true); });
}

function subscribeEvents(){
  onSnapshot(collection(db, 'events'), function(snap){
    hooks.setEvents(snap.docs.map(function(d){
      var x = d.data();
      return { id: d.id, date: x.date, time: x.time || '', fr: x.fr, ar: x.ar };
    }));
  }, function(err){ hooks.error(err, true); });
}

/* =========================================================
   BUREAUX LOCAUX
   ========================================================= */

function subscribeLocaux(){
  unsub('locaux');
  unsubs.locaux = onSnapshot(collection(db, 'locaux'), function(snap){
    hooks.setLocaux(snap.docs.map(function(d){
      var x = d.data();
      return { id: d.id, name: x.name || '', type: x.type || 'ville', province: x.province || '' };
    }));
  }, function(err){ hooks.error(err, true); });
}

/* =========================================================
   MEMBRES (gestion)
   ========================================================= */

function subscribeMembers(){
  unsub('members');
  if (!session.user || !(session.isAdmin || isResp())){ hooks.setMembers([]); return; }

  var q;
  if (session.isAdmin) q = collection(db, 'members');
  else if (session.isRespProv) q = query(collection(db, 'members'), where('prov', '==', session.member.adminProvince));
  else q = query(collection(db, 'members'), where('prov', '==', session.member.adminProvince), where('local', '==', session.member.adminLocal));

  unsubs.members = onSnapshot(q, function(snap){
    hooks.setMembers(snap.docs.map(function(d){ return normalizeMember(d.data(), d.id); }));
  }, function(err){ hooks.error(err); });
}

/* =========================================================
   DOSSIERS
   ========================================================= */

function subscribeDossiers(){
  unsub('dossiers');
  if (!session.user) return;

  var q;
  if (session.isAdmin) q = collection(db, 'dossiers');
  else if (session.isRespProv) q = query(collection(db, 'dossiers'), where('province', '==', session.member.adminProvince));
  else if (session.isRespLocal) q = query(collection(db, 'dossiers'), where('province', '==', session.member.adminProvince), where('local', '==', session.member.adminLocal));
  else q = query(collection(db, 'dossiers'), where('ownerUid', '==', session.user.uid));

  unsubs.dossiers = onSnapshot(q, function(snap){
    hooks.setDossiers(snap.docs.map(function(d){
      var x = d.data();
      return {
        id: d.id,
        ownerUid: x.ownerUid || '',
        anonymous: !!x.anonymous,
        name: x.name || '',
        etab: x.etab || '',
        title: x.title || '',
        category: x.category || '',
        description: x.description || '',
        province: x.province || '',
        local: x.local || '',
        attachmentName: x.attachmentName || '',
        attachmentType: x.attachmentType || '',
        attachmentData: x.attachmentData || '',
        status: x.status || 'nouveau',
        response: x.response || '',
        assignedTo: x.assignedTo || '',
        assignedToName: x.assignedToName || '',
        history: x.history || [],
        createdAt: ms(x.createdAt),
        updatedAt: ms(x.updatedAt)
      };
    }).sort(function(a,b){ return (b.createdAt || 0) - (a.createdAt || 0); }));
  }, function(err){ hooks.error(err, true); });
}

async function addDossier(o){
  if (!auth.currentUser) throw new Error('Non connecte');
  var anonymous = !!o.anonymous;
  var data = {
    ownerUid: anonymous ? '' : auth.currentUser.uid,
    anonymous: anonymous,
    name: anonymous ? '' : String(o.name || '').slice(0,120),
    etab: String(o.etab || '').slice(0,160),
    title: String(o.title || '').slice(0,160),
    category: String(o.category || '').slice(0,60),
    description: String(o.description || '').slice(0,4000),
    province: session.member ? String(session.member.prov || '').slice(0,40) : '',
    local: session.member ? String(session.member.local || '').slice(0,80) : '',
    attachmentName: String(o.attachmentName || '').slice(0,120),
    attachmentType: String(o.attachmentType || '').slice(0,80),
    attachmentData: String(o.attachmentData || '').slice(0,420000),
    status: 'nouveau',
    response: '',
    assignedTo: '',
    assignedToName: '',
    history: [{ ts: Date.now(), action: 'Dossier cree', by: anonymous ? 'Anonyme' : (session.member ? session.member.name : '') }],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  return addDoc(collection(db, 'dossiers'), data);
}

function updateDossierStatus(id, status, response, actorName){
  var entry = { ts: Date.now(), action: 'Statut : ' + status, by: actorName || '' };
  var data = { status: status, updatedAt: serverTimestamp(), history: arrayUnion(entry) };
  if (response !== undefined) data.response = String(response || '').slice(0,3000);
  return updateDoc(doc(db, 'dossiers', id), data);
}

function assignDossier(id, uid, name, actorName){
  var entry = { ts: Date.now(), action: 'Assigne a ' + (name || ''), by: actorName || '' };
  return updateDoc(doc(db, 'dossiers', id), {
    assignedTo: uid || '', assignedToName: name || '', updatedAt: serverTimestamp(), history: arrayUnion(entry)
  });
}

/* =========================================================
   REUNIONS
   ========================================================= */

function subscribeReunions(){
  unsub('reunions');
  if (!session.user) return;

  var q;
  if (session.isAdmin) q = collection(db, 'reunions');
  else if (session.isRespProv) q = query(collection(db, 'reunions'), where('province', '==', session.member.adminProvince));
  else if (session.isRespLocal) q = query(collection(db, 'reunions'), where('province', '==', session.member.adminProvince), where('local', '==', session.member.adminLocal));
  else if (session.member) q = query(collection(db, 'reunions'), where('province', '==', session.member.prov));
  else { hooks.setReunions([]); return; }

  unsubs.reunions = onSnapshot(q, function(snap){
    hooks.setReunions(snap.docs.map(function(d){
      var x = d.data();
      return {
        id: d.id, title: x.title || '', date: x.date || '', time: x.time || '', lieu: x.lieu || '',
        province: x.province || '', local: x.local || '', ordreDuJour: x.ordreDuJour || '',
        status: x.status || 'planifiee', compteRendu: x.compteRendu || '',
        createdBy: x.createdBy || '', createdAt: ms(x.createdAt), updatedAt: ms(x.updatedAt)
      };
    }).sort(function(a,b){ return (a.date || '').localeCompare(b.date || ''); }));
  }, function(err){ hooks.error(err, true); });
}

function addReunion(o){
  var data = {
    title: String(o.title || '').slice(0,160),
    date: String(o.date || '').slice(0,20),
    time: String(o.time || '').slice(0,10),
    lieu: String(o.lieu || '').slice(0,160),
    province: String(o.province || '').slice(0,40),
    local: String(o.local || '').slice(0,80),
    ordreDuJour: String(o.ordreDuJour || '').slice(0,2000),
    status: 'planifiee',
    compteRendu: '',
    createdBy: session.member ? session.member.name : (session.user ? session.user.name : ''),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  return addDoc(collection(db, 'reunions'), data);
}

function updateReunion(id, fields){
  var data = Object.assign({}, fields, { updatedAt: serverTimestamp() });
  if (data.ordreDuJour !== undefined) data.ordreDuJour = String(data.ordreDuJour || '').slice(0,2000);
  if (data.compteRendu !== undefined) data.compteRendu = String(data.compteRendu || '').slice(0,4000);
  return updateDoc(doc(db, 'reunions', id), data);
}

function deleteReunion(id){
  return deleteDoc(doc(db, 'reunions', id));
}

/* =========================================================
   AUTHENTIFICATION
   ========================================================= */

function onUser(user){
  unsub('member');
  unsub('members');

  if (!user){
    unsub('dossiers'); unsub('reunions');
    session = { user: null, member: null, isAdmin: false, isRespProv: false, isRespLocal: false };
    hooks.setSession(session);
    hooks.setMembers([]); hooks.setDossiers([]); hooks.setReunions([]);
    subscribeNews();
    return;
  }

  var admins = (hooks.adminEmails || []).map(function(x){ return String(x).toLowerCase(); });
  var isAdmin = !!user.emailVerified && admins.indexOf((user.email || '').toLowerCase()) >= 0;

  session = {
    user: { uid: user.uid, name: user.displayName || '', email: user.email || '', photo: user.photoURL || '' },
    member: null,
    isAdmin: isAdmin,
    isRespProv: false,
    isRespLocal: false
  };

  hooks.setSession(session);

  var ref = doc(db, 'members', user.uid);

  unsubs.member = onSnapshot(ref, function(snap){
    if (!snap.exists()){
      if (!snap.metadata.fromCache){
        setDoc(ref, {
          name: user.displayName || '', email: user.email || '', photo: user.photoURL || '',
          etab: '', prov: '', local: '', phone: '', status: 'pending', createdAt: serverTimestamp()
        }).catch(function(e){ hooks.error(e); });
      }
      return;
    }

    session.member = normalizeMember(snap.data(), user.uid);
    session.isRespProv = session.member.status === 'active' && session.member.role === 'resp_provincial';
    session.isRespLocal = session.member.status === 'active' && session.member.role === 'resp_local';

    hooks.setSession(session);
    subscribeMembers();
    subscribeNews();
    subscribeDossiers();
    subscribeReunions();
  }, function(err){ hooks.error(err); });

  subscribeMembers();
  subscribeNews();
  subscribeDossiers();
  subscribeReunions();
}

/* =========================================================
   GOOGLE LOGIN
   ========================================================= */

async function signIn(){
  try {
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()){
      if (!nativeAuth) throw new Error("Le module FirebaseAuthentication n'est pas disponible dans l'APK.");
      var result = await nativeAuth.signInWithGoogle({ useCredentialManager: true, skipNativeAuth: true });
      var idToken = result && result.credential && result.credential.idToken;
      if (!idToken) throw new Error("Google n'a pas fourni de jeton d'authentification.");
      var credential = GoogleAuthProvider.credential(idToken);
      await signInWithCredential(auth, credential);
      return;
    }
    var provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
  }
  catch(e){
    if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) return;
    throw e;
  }
}

/* =========================================================
   DECONNEXION
   ========================================================= */

async function signOut(){
  if (nativeAuth && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()){
    try { await nativeAuth.signOut(); } catch(e){}
  }
  await fbSignOut(auth);
}

/* =========================================================
   PROFIL
   ========================================================= */

async function saveProfile(p){
  var u = auth.currentUser;
  if (!u) throw new Error('Non connecte');

  var ref = doc(db, 'members', u.uid);
  var snap = await getDoc(ref);

  var fields = {
    name: String(p.name || '').slice(0,120),
    etab: String(p.etab || '').slice(0,160),
    prov: String(p.prov || '').slice(0,40),
    local: String(p.local || '').slice(0,80),
    phone: String(p.phone || '').slice(0,30)
  };

  if (!snap.exists()){
    await setDoc(ref, {
      name: fields.name, email: u.email || '', photo: u.photoURL || '',
      etab: fields.etab, prov: fields.prov, local: fields.local, phone: fields.phone,
      status: 'pending', createdAt: serverTimestamp()
    });
  } else {
    await updateDoc(ref, Object.assign({}, fields, { updatedAt: serverTimestamp() }));
    var prior = snap.data();
    if ((prior.role === 'resp_provincial' || prior.role === 'resp_local') && prior.adminProvince){
      var sectorId = prior.role === 'resp_provincial' ? prior.adminProvince : (prior.adminProvince + '__' + prior.adminLocal);
      await setDoc(doc(db, 'sectorContacts', sectorId), {
        uid: u.uid, name: fields.name, phone: fields.phone, province: prior.adminProvince, local: prior.role === 'resp_local' ? prior.adminLocal : ''
      });
    }
  }
}

/* =========================================================
   SUPPRESSION COMPTE
   ========================================================= */

async function deleteAccount(){
  var u = auth.currentUser;
  if (!u) throw new Error('Non connecte');

  unsub('member'); unsub('members'); unsub('dossiers'); unsub('reunions');

  await deleteDoc(doc(db, 'members', u.uid));

  try {
    await deleteUser(u);
  } catch(e){
    if (e.code === 'auth/requires-recent-login'){
      await reauthenticateWithPopup(u, new GoogleAuthProvider());
      await deleteUser(u);
    } else {
      await fbSignOut(auth);
    }
  }
}

/* =========================================================
   ADMINISTRATION
   ========================================================= */

var admin = {

  addLocal: function(name, type, province){
    return addDoc(collection(db, 'locaux'), {
      name: String(name || '').slice(0,80),
      type: type === 'etablissement' ? 'etablissement' : 'ville',
      province: String(province || '').slice(0,40),
      createdAt: serverTimestamp()
    });
  },

  deleteLocal: function(id){
    return deleteDoc(doc(db, 'locaux', id));
  },

  setRespProvincial: function(uid, province){
    var prov = String(province || '').slice(0,40);
    return getDoc(doc(db, 'members', uid)).then(function(snap){
      if (!snap.exists()) throw new Error('Membre introuvable');
      if (snap.data().status !== 'active') throw new Error('Seul un adherent actif peut devenir responsable.');
      return updateDoc(doc(db, 'members', uid), { role: 'resp_provincial', adminProvince: prov, adminLocal: '' });
    });
  },

  setRespLocal: function(uid, province, local){
    var prov = String(province || '').slice(0,40);
    var loc = String(local || '').slice(0,80);
    return getDoc(doc(db, 'members', uid)).then(function(snap){
      if (!snap.exists()) throw new Error('Membre introuvable');
      if (snap.data().status !== 'active') throw new Error('Seul un adherent actif peut devenir responsable.');
      return updateDoc(doc(db, 'members', uid), { role: 'resp_local', adminProvince: prov, adminLocal: loc });
    });
  },

  removeResp: function(uid){
    return updateDoc(doc(db, 'members', uid), { role: 'member', adminProvince: '', adminLocal: '' });
  },

  setStatus: function(uid, status, memberNo){
    var ref = doc(db, 'members', uid);
    return getDoc(ref).then(function(snap){
      var prior = snap.exists() ? snap.data() : {};
      var data = { status: status };
      if (memberNo){ data.memberNo = String(memberNo).slice(0,30); data.activatedAt = serverTimestamp(); }
      if (status !== 'active' && (prior.role === 'resp_provincial' || prior.role === 'resp_local')){
        data.role = 'member'; data.adminProvince = ''; data.adminLocal = '';
      }
      return updateDoc(ref, data);
    });
  },

  deleteMember: function(uid){
    return deleteDoc(doc(db, 'members', uid));
  },

  addNews: function(o){
    var data = { cat: o.cat, audience: o.audience, date: o.date, createdAt: serverTimestamp() };
    if (o.province) data.province = o.province;
    if (o.local) data.local = o.local;
    if (o.image) data.image = String(o.image).slice(0,400000);
    if (o.fr) data.fr = o.fr;
    if (o.ar) data.ar = o.ar;
    return addDoc(collection(db, 'news'), data);
  },

  deleteNews: function(id){ return deleteDoc(doc(db, 'news', id)); },

  addEvent: function(o){
    var data = { date: o.date, time: o.time || '', createdAt: serverTimestamp() };
    if (o.fr) data.fr = o.fr;
    if (o.ar) data.ar = o.ar;
    return addDoc(collection(db, 'events'), data);
  },

  deleteEvent: function(id){ return deleteDoc(doc(db, 'events', id)); },

  addReunion: addReunion,
  updateReunion: updateReunion,
  deleteReunion: deleteReunion,

  updateDossierStatus: updateDossierStatus,
  assignDossier: assignDossier
};

/* =========================================================
   FIREBASE AUTHENTICATION NATIVE
   ========================================================= */

async function loadNativeAuth(){
  if (!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) return;
  try {
    if (window.Capacitor.Plugins && window.Capacitor.Plugins.FirebaseAuthentication){
      nativeAuth = window.Capacitor.Plugins.FirebaseAuthentication;
      return;
    }
    var mod = await import('https://cdn.jsdelivr.net/npm/@capacitor-firebase/authentication@7/dist/esm/index.js');
    nativeAuth = mod.FirebaseAuthentication || (mod.default && mod.default.FirebaseAuthentication) || mod.default || null;
    if (!nativeAuth && window.Capacitor.Plugins) nativeAuth = window.Capacitor.Plugins.FirebaseAuthentication || null;
    if (!nativeAuth) throw new Error("FirebaseAuthentication non enregistre.");
  } catch(e){
    console.error("Chargement FirebaseAuthentication:", e);
    nativeAuth = null;
  }
}

/* =========================================================
   INITIALISATION
   ========================================================= */

export async function init(config, h){
  hooks = h;
  await loadNativeAuth();

  var app = initializeApp(config);
  auth = getAuth(app);

  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch(e){
    db = getFirestore(app);
  }

  window.CLOUD = {
    signIn: signIn,
    signOut: signOut,
    saveProfile: saveProfile,
    deleteAccount: deleteAccount,
    addDossier: addDossier,
    admin: admin
  };

  subscribeEvents();
  subscribeLocaux();

  onAuthStateChanged(auth, onUser);

  hooks.ready();
}
