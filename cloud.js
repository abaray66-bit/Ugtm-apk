/* cloud.js – connexion Google et données partagées (Firebase).
   Ce module n'est chargé que si "firebase" est renseigné dans data.js.
   S'il ne peut pas se charger (hors connexion...), l'application continue de fonctionner avec data.js. */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup,
  reauthenticateWithPopup, onAuthStateChanged, signOut as fbSignOut, deleteUser
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, onSnapshot, query, where, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

var auth, db, hooks;
var unsubs = { member: null, members: null, news: null };
var newsMode = null;
var session = { user: null, member: null, isAdmin: false };

function ms(v){ return (v && typeof v.toMillis === 'function') ? v.toMillis() : null; }

function normalizeMember(d, uid){
  return {
    uid: uid, name: d.name || '', email: d.email || '', photo: d.photo || '',
    etab: d.etab || '', prov: d.prov || '', phone: d.phone || '',
    status: d.status || 'pending', memberNo: d.memberNo || '',
    createdAt: ms(d.createdAt), activatedAt: ms(d.activatedAt)
  };
}

function unsub(key){ if (unsubs[key]){ unsubs[key](); unsubs[key] = null; } }

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
      return { id: d.id, cat: x.cat, audience: x.audience, date: x.date, fr: x.fr, ar: x.ar };
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

function onUser(user){
  unsub('member'); unsub('members');
  if (!user){
    session = { user: null, member: null, isAdmin: false };
    hooks.setSession(session);
    hooks.setMembers([]);
    subscribeNews();
    return;
  }
  var admins = (hooks.adminEmails || []).map(function(x){ return String(x).toLowerCase(); });
  var isAdmin = !!user.emailVerified && admins.indexOf((user.email || '').toLowerCase()) >= 0;
  session = {
    user: { uid: user.uid, name: user.displayName || '', email: user.email || '', photo: user.photoURL || '' },
    member: null, isAdmin: isAdmin
  };
  hooks.setSession(session);

  var ref = doc(db, 'members', user.uid);
  unsubs.member = onSnapshot(ref, function(snap){
    if (!snap.exists()){
      // Première connexion : on crée le profil, en attente de validation.
      if (!snap.metadata.fromCache){
        setDoc(ref, {
          name: user.displayName || '', email: user.email || '', photo: user.photoURL || '',
          etab: '', prov: '', phone: '', status: 'pending', createdAt: serverTimestamp()
        }).catch(function(e){ hooks.error(e); });
      }
      return;
    }
    session.member = normalizeMember(snap.data(), user.uid);
    hooks.setSession(session);
    subscribeNews();
  }, function(err){ hooks.error(err); });

  if (isAdmin){
    unsubs.members = onSnapshot(collection(db, 'members'), function(snap){
      hooks.setMembers(snap.docs.map(function(d){ return normalizeMember(d.data(), d.id); }));
    }, function(err){ hooks.error(err); });
  }
  subscribeNews();
}

async function signIn(){
  var provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
    var blocked = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'];
    if (blocked.indexOf(e.code) >= 0){
      var friendly = new Error("Impossible d'ouvrir la fenêtre de connexion Google. Vérifiez que les pop-ups sont autorisés pour ce site, désactivez la navigation privée, et réessayez.");
      friendly.code = e.code;
      throw friendly;
    }
    throw e;
  }
}

async function signOut(){ await fbSignOut(auth); }

async function saveProfile(p){
  var u = auth.currentUser;
  if (!u) throw new Error('Non connecté');

  // Le profil peut ne pas encore exister si l'utilisateur vient juste de
  // terminer sa connexion Google. On vérifie donc son existence avant de
  // choisir entre create et update, afin d'éviter updateDoc + permission-denied.
  var ref = doc(db, 'members', u.uid);
  var snap = await getDoc(ref);
  var fields = {
    name: String(p.name || '').slice(0, 120),
    etab: String(p.etab || '').slice(0, 160),
    prov: String(p.prov || '').slice(0, 40),
    phone: String(p.phone || '').slice(0, 30)
  };

  if (!snap.exists()) {
    await setDoc(ref, {
      name: fields.name,
      email: u.email || '',
      photo: u.photoURL || '',
      etab: fields.etab,
      prov: fields.prov,
      phone: fields.phone,
      status: 'pending',
      createdAt: serverTimestamp()
    });
  } else {
    await updateDoc(ref, Object.assign({}, fields, { updatedAt: serverTimestamp() }));
  }
}

async function deleteAccount(){
  var u = auth.currentUser;
  if (!u) throw new Error('Non connecté');
  unsub('member'); unsub('members');           // évite que le profil soit recréé aussitôt
  await deleteDoc(doc(db, 'members', u.uid));
  try {
    await deleteUser(u);
  } catch (e) {
    if (e.code === 'auth/requires-recent-login'){
      await reauthenticateWithPopup(u, new GoogleAuthProvider());
      await deleteUser(u);
    } else {
      await fbSignOut(auth);
    }
  }
}

var admin = {
  setStatus: function(uid, status, memberNo){
    var data = { status: status };
    if (memberNo){ data.memberNo = String(memberNo).slice(0, 30); data.activatedAt = serverTimestamp(); }
    return updateDoc(doc(db, 'members', uid), data);
  },
  deleteMember: function(uid){ return deleteDoc(doc(db, 'members', uid)); },
  addNews: function(o){
    var data = { cat: o.cat, audience: o.audience, date: o.date, createdAt: serverTimestamp() };
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
  deleteEvent: function(id){ return deleteDoc(doc(db, 'events', id)); }
};

export async function init(config, h){
  hooks = h;
  var app = initializeApp(config);
  auth = getAuth(app);
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) {
    db = getFirestore(app);
  }
  window.CLOUD = { signIn: signIn, signOut: signOut, saveProfile: saveProfile, deleteAccount: deleteAccount, admin: admin };
  subscribeEvents();
  onAuthStateChanged(auth, onUser);
  hooks.ready();
}
