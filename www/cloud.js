/* cloud.js – connexion Google et données partagées (Firebase).
   Ce module n'est chargé que si "firebase" est renseigné dans data.js.
   S'il ne peut pas se charger (hors connexion...), l'application continue de fonctionner avec data.js. */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithCredential,
  reauthenticateWithPopup, onAuthStateChanged, signOut as fbSignOut, deleteUser
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
  onSnapshot, query, where, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

var auth, db, hooks;
var nativeAuth = null;

var unsubs = {
  member: null,
  members: null,
  news: null,
  reports: null
};

var newsMode = null;

var session = {
  user: null,
  member: null,
  isAdmin: false
};

function ms(v){
  return (v && typeof v.toMillis === 'function') ? v.toMillis() : null;
}

function normalizeMember(d, uid){
  return {
    uid: uid,
    name: d.name || '',
    email: d.email || '',
    photo: d.photo || '',
    etab: d.etab || '',
    prov: d.prov || '',
    phone: d.phone || '',
    status: d.status || 'pending',
    memberNo: d.memberNo || '',
    role: d.role || 'member',
    adminProvince: d.adminProvince || '',
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

function subscribeNews(){

  var mode =
    (session.isAdmin ||
    (session.member && session.member.status === 'active'))
    ? 'all'
    : 'public';

  if (mode === newsMode && unsubs.news) return;

  newsMode = mode;

  unsub('news');

  var q = mode === 'all'
    ? collection(db, 'news')
    : query(
        collection(db, 'news'),
        where('audience', '==', 'public')
      );

  unsubs.news = onSnapshot(
    q,
    function(snap){

      hooks.setNews(
        snap.docs.map(function(d){

          var x = d.data();

          return {
            id: d.id,
            cat: x.cat,
            audience: x.audience,
            date: x.date,
            image: x.image || '',
            fr: x.fr,
            ar: x.ar
          };

        })
      );

    },
    function(err){
      hooks.error(err, true);
    }
  );
}

function subscribeEvents(){

  onSnapshot(
    collection(db, 'events'),

    function(snap){

      hooks.setEvents(
        snap.docs.map(function(d){

          var x = d.data();

          return {
            id: d.id,
            date: x.date,
            time: x.time || '',
            fr: x.fr,
            ar: x.ar
          };

        })
      );

    },

    function(err){
      hooks.error(err, true);
    }
  );
}


/* =========================================================
   SIGNALEMENTS
   ========================================================= */

function subscribeMembers(){
  unsub('members');
  if (!session.user || !(session.isAdmin || session.isSubAdmin)) { hooks.setMembers([]); return; }
  var membersQuery = session.isAdmin
    ? collection(db, 'members')
    : query(collection(db, 'members'), where('prov', '==', session.member.adminProvince));
  unsubs.members = onSnapshot(membersQuery, function(snap){
    hooks.setMembers(snap.docs.map(function(d){return normalizeMember(d.data(), d.id);}));
  }, function(err){hooks.error(err);});
}

function subscribeReports(){

  unsub('reports');

  if (!session.user) return;

  var q;

  if (session.isAdmin){

    q = collection(db, 'reports');

  } else {

    q = query(
      collection(db, 'reports'),
      where(session.isSubAdmin ? 'province' : 'ownerUid', '==', session.isSubAdmin ? session.member.adminProvince : session.user.uid)
    );

  }

  unsubs.reports = onSnapshot(

    q,

    function(snap){

      hooks.setReports(

        snap.docs.map(function(d){

          var x = d.data();

          return {
            id: d.id,

            ownerUid: x.ownerUid || '',

            anonymous: !!x.anonymous,

            name: x.name || '',
            etab: x.etab || '',
            category: x.category || '',
            description: x.description || '',
            date: x.date || '',
            location: x.location || '',
            province: x.province || '',

            attachmentName: x.attachmentName || '',
            attachmentType: x.attachmentType || '',
            attachmentData: x.attachmentData || '',

            status: x.status || 'new',
            response: x.response || '',

            createdAt: ms(x.createdAt),
            updatedAt: ms(x.updatedAt)
          };

        }).sort(function(a,b){

          return (b.createdAt || 0) -
                 (a.createdAt || 0);

        })

      );

    },

    function(err){

      hooks.error(err, true);

    }

  );
}


/* =========================================================
   AUTHENTIFICATION
   ========================================================= */

function onUser(user){

  unsub('member');
  unsub('members');

  if (!user){

    unsub('reports');

    session = {
      user: null,
      member: null,
      isAdmin: false,
      isSubAdmin: false
    };

    hooks.setSession(session);
    hooks.setMembers([]);
    hooks.setReports([]);

    subscribeNews();

    return;
  }


  var admins =
    (hooks.adminEmails || [])
    .map(function(x){
      return String(x).toLowerCase();
    });


  var isAdmin =
    !!user.emailVerified &&
    admins.indexOf(
      (user.email || '').toLowerCase()
    ) >= 0;


  session = {

    user: {
      uid: user.uid,
      name: user.displayName || '',
      email: user.email || '',
      photo: user.photoURL || ''
    },

    member: null,

    isAdmin: isAdmin,
    isSubAdmin: false

  };


  hooks.setSession(session);


  var ref =
    doc(db, 'members', user.uid);


  unsubs.member = onSnapshot(

    ref,

    function(snap){

      if (!snap.exists()){

        if (!snap.metadata.fromCache){

          setDoc(
            ref,
            {
              name: user.displayName || '',
              email: user.email || '',
              photo: user.photoURL || '',
              etab: '',
              prov: '',
              phone: '',
              status: 'pending',
              createdAt: serverTimestamp()
            }
          )
          .catch(function(e){
            hooks.error(e);
          });

        }

        return;
      }


      session.member =
        normalizeMember(
          snap.data(),
          user.uid
        );
      session.isSubAdmin = session.member.status === 'active' && session.member.role === 'subadmin';

      hooks.setSession(session);
      subscribeMembers();

      subscribeNews();

      subscribeReports();

    },

    function(err){
      hooks.error(err);
    }

  );


  subscribeMembers();


  subscribeNews();
  subscribeReports();

}


/* =========================================================
   GOOGLE LOGIN
   ========================================================= */

async function signIn(){

  try {

    if (
      window.Capacitor &&
      window.Capacitor.isNativePlatform &&
      window.Capacitor.isNativePlatform()
    ){

      if (!nativeAuth){

        throw new Error(
          "Le module FirebaseAuthentication n'est pas disponible dans l'APK."
        );

      }


      var result =
        await nativeAuth.signInWithGoogle({

          useCredentialManager: true,
          skipNativeAuth: true

        });


      var idToken =
        result &&
        result.credential &&
        result.credential.idToken;


      if (!idToken){

        throw new Error(
          "Google n'a pas fourni de jeton d'authentification."
        );

      }


      var credential =
        GoogleAuthProvider.credential(idToken);


      await signInWithCredential(
        auth,
        credential
      );

      return;

    }


    var provider =
      new GoogleAuthProvider();


    provider.setCustomParameters({
      prompt: 'select_account'
    });


    await signInWithPopup(
      auth,
      provider
    );

  }

  catch(e){

    if (
      e &&
      (
        e.code === 'auth/popup-closed-by-user' ||
        e.code === 'auth/cancelled-popup-request'
      )
    ){
      return;
    }

    throw e;

  }

}


/* =========================================================
   DECONNEXION
   ========================================================= */

async function signOut(){

  if (
    nativeAuth &&
    window.Capacitor &&
    window.Capacitor.isNativePlatform &&
    window.Capacitor.isNativePlatform()
  ){

    try {
      await nativeAuth.signOut();
    }
    catch(e){}

  }

  await fbSignOut(auth);

}


/* =========================================================
   AJOUT SIGNALEMENT
   ========================================================= */

async function addReport(o){

  if (!auth.currentUser){

    throw new Error(
      'Non connecté'
    );

  }


  var anonymous = !!o.anonymous;


  var data = {

    ownerUid:
      anonymous
        ? ''
        : auth.currentUser.uid,

    anonymous: anonymous,

    name:
      anonymous
        ? ''
        : String(o.name || '').slice(0,120),

    etab:
      String(o.etab || '').slice(0,160),

    category:
      String(o.category || '').slice(0,60),

    description:
      String(o.description || '').slice(0,4000),

    date:
      String(o.date || '').slice(0,20),

    location:
      String(o.location || '').slice(0,160),

    province:
      String(
        o.province ||
        (session.member ? session.member.prov || '' : '')
      ).slice(0,40),

    attachmentName:
      String(o.attachmentName || '').slice(0,120),

    attachmentType:
      String(o.attachmentType || '').slice(0,80),

    attachmentData:
      String(o.attachmentData || '').slice(0,420000),

    status: 'new',

    response: '',

    createdAt: serverTimestamp(),

    updatedAt: serverTimestamp()

  };


  return addDoc(
    collection(db, 'reports'),
    data
  );

}


/* =========================================================
   PROFIL
   ========================================================= */

async function saveProfile(p){

  var u = auth.currentUser;

  if (!u)
    throw new Error('Non connecté');


  var ref =
    doc(db, 'members', u.uid);


  var snap =
    await getDoc(ref);


  var fields = {

    name:
      String(p.name || '').slice(0,120),

    etab:
      String(p.etab || '').slice(0,160),

    prov:
      String(p.prov || '').slice(0,40),

    phone:
      String(p.phone || '').slice(0,30)

  };


  if (!snap.exists()){

    await setDoc(

      ref,

      {

        name: fields.name,
        email: u.email || '',
        photo: u.photoURL || '',

        etab: fields.etab,
        prov: fields.prov,
        phone: fields.phone,

        status: 'pending',

        createdAt:
          serverTimestamp()

      }

    );

  }

  else {

    await updateDoc(

      ref,

      Object.assign(
        {},
        fields,
        {
          updatedAt:
            serverTimestamp()
        }
      )

    );
    if (snap.data().role === 'subadmin' && snap.data().adminProvince){
      await setDoc(doc(db, 'provinceContacts', snap.data().adminProvince), {
        uid: u.uid, name: fields.name, phone: fields.phone, province: snap.data().adminProvince
      });
    }

  }

}


/* =========================================================
   SUPPRESSION COMPTE
   ========================================================= */

async function deleteAccount(){

  var u = auth.currentUser;

  if (!u)
    throw new Error('Non connecté');


  unsub('member');
  unsub('members');
  unsub('reports');


  await deleteDoc(
    doc(db, 'members', u.uid)
  );


  try {

    await deleteUser(u);

  }

  catch(e){

    if (
      e.code ===
      'auth/requires-recent-login'
    ){

      await reauthenticateWithPopup(
        u,
        new GoogleAuthProvider()
      );

      await deleteUser(u);

    }

    else {

      await fbSignOut(auth);

    }

  }

}


/* =========================================================
   ADMINISTRATION
   ========================================================= */

var admin = {

  setSubAdmin:
    function(uid, province){
      var assigned = String(province || '').slice(0,40);
      return getDoc(doc(db, 'members', uid)).then(function(snap){
        if (!snap.exists()) throw new Error('Membre introuvable');
        var member = snap.data();
        if (member.status !== 'active') throw new Error('Seul un adhérent actif peut devenir sous-admin.');
        var old = member.adminProvince || '';
        return getDoc(doc(db, 'provinceContacts', assigned)).then(function(existing){
          if (existing.exists() && existing.data().uid !== uid)
            throw new Error('Un sous-admin est déjà affecté à ce secteur. Retirez son rôle avant de le remplacer.');
          return updateDoc(doc(db, 'members', uid), {role: 'subadmin', adminProvince: assigned});
        }).then(function(){
          return old && old !== assigned ? getDoc(doc(db, 'provinceContacts', old)) : null;
        }).then(function(oldContact){
          var clearOld = oldContact && oldContact.exists() && oldContact.data().uid === uid
            ? deleteDoc(doc(db, 'provinceContacts', old)) : Promise.resolve();
          return clearOld.then(function(){return setDoc(doc(db, 'provinceContacts', assigned), {
            uid: uid,
            name: String(member.name || '').slice(0,120),
            phone: String(member.phone || '').slice(0,30),
            province: assigned
          });});
        });
      });
    },

  removeSubAdmin:
    function(uid){
      return getDoc(doc(db, 'members', uid)).then(function(memberSnap){
        var old = memberSnap.exists() ? memberSnap.data().adminProvince : '';
        var clear = updateDoc(doc(db, 'members', uid), {role: 'member', adminProvince: ''});
        if (!old) return clear;
        return clear.then(function(){
          return getDoc(doc(db, 'provinceContacts', old));
        }).then(function(contact){
          if (contact.exists() && contact.data().uid === uid) return deleteDoc(doc(db, 'provinceContacts', old));
        });
      });
    },

  getSubAdminContact:
    function(province){
      return getDoc(doc(db, 'provinceContacts', province)).then(function(snap){
        return snap.exists() ? snap.data() : null;
      });
    },

  setStatus:
    function(uid, status, memberNo){
      var ref = doc(db, 'members', uid);
      return getDoc(ref).then(function(snap){
        var prior = snap.exists() ? snap.data() : {};
        var data = {status: status};
        if (memberNo){
          data.memberNo = String(memberNo).slice(0,30);
          data.activatedAt = serverTimestamp();
        }
        if (status !== 'active' && prior.role === 'subadmin'){
          data.role = 'member';
          data.adminProvince = '';
        }
        return updateDoc(ref, data).then(function(){
          if (status === 'active' || !prior.adminProvince) return;
          return getDoc(doc(db, 'provinceContacts', prior.adminProvince)).then(function(contact){
            if (contact.exists() && contact.data().uid === uid)
              return deleteDoc(doc(db, 'provinceContacts', prior.adminProvince));
          });
        });
      });
    },


  deleteMember:
    function(uid){
      var ref = doc(db, 'members', uid);
      return getDoc(ref).then(function(snap){
        var province = snap.exists() ? snap.data().adminProvince : '';
        var removeContact = province ? getDoc(doc(db, 'provinceContacts', province)).then(function(contact){
          if (contact.exists() && contact.data().uid === uid) return deleteDoc(doc(db, 'provinceContacts', province));
        }) : Promise.resolve();
        return removeContact.then(function(){return deleteDoc(ref);});
      });
    },


  addNews:
    function(o){

      var data = {

        cat: o.cat,

        audience: o.audience,

        date: o.date,

        createdAt:
          serverTimestamp()

      };

      if (o.image)
        data.image = String(o.image).slice(0,400000);

      if (o.fr)
        data.fr = o.fr;

      if (o.ar)
        data.ar = o.ar;

      return addDoc(
        collection(db, 'news'),
        data
      );

    },


  deleteNews:
    function(id){

      return deleteDoc(
        doc(db, 'news', id)
      );

    },


  addEvent:
    function(o){

      var data = {

        date: o.date,

        time: o.time || '',

        createdAt:
          serverTimestamp()

      };

      if (o.fr)
        data.fr = o.fr;

      if (o.ar)
        data.ar = o.ar;

      return addDoc(
        collection(db, 'events'),
        data
      );

    },


  deleteEvent:
    function(id){

      return deleteDoc(
        doc(db, 'events', id)
      );

    },


  updateReport:
    function(id, status, response){

      return updateDoc(

        doc(db, 'reports', id),

        {

          status: status,

          response:
            String(response || '')
            .slice(0,3000),

          updatedAt:
            serverTimestamp()

        }

      );

    }

};


/* =========================================================
   FIREBASE AUTHENTICATION NATIVE
   ========================================================= */

async function loadNativeAuth(){

  if (
    !(
      window.Capacitor &&
      window.Capacitor.isNativePlatform &&
      window.Capacitor.isNativePlatform()
    )
  ){
    return;
  }


  try {

    if (
      window.Capacitor.Plugins &&
      window.Capacitor.Plugins.FirebaseAuthentication
    ){

      nativeAuth =
        window.Capacitor.Plugins.FirebaseAuthentication;

      return;

    }


    var mod =
      await import(
        'https://cdn.jsdelivr.net/npm/@capacitor-firebase/authentication@7/dist/esm/index.js'
      );


    nativeAuth =
      mod.FirebaseAuthentication ||
      (
        mod.default &&
        mod.default.FirebaseAuthentication
      ) ||
      mod.default ||
      null;


    if (
      !nativeAuth &&
      window.Capacitor.Plugins
    ){

      nativeAuth =
        window.Capacitor.Plugins.FirebaseAuthentication ||
        null;

    }


    if (!nativeAuth){

      throw new Error(
        "FirebaseAuthentication non enregistré."
      );

    }

  }

  catch(e){

    console.error(
      "Chargement FirebaseAuthentication:",
      e
    );

    nativeAuth = null;

  }

}


/* =========================================================
   INITIALISATION
   ========================================================= */

export async function init(config, h){

  hooks = h;


  await loadNativeAuth();


  var app =
    initializeApp(config);


  auth =
    getAuth(app);


  try {

    db =
      initializeFirestore(

        app,

        {

          localCache:
            persistentLocalCache({

              tabManager:
                persistentMultipleTabManager()

            })

        }

      );

  }

  catch(e){

    db =
      getFirestore(app);

  }


  window.CLOUD = {

    signIn: signIn,

    signOut: signOut,

    saveProfile: saveProfile,

    deleteAccount: deleteAccount,

    addReport: addReport,

    admin: admin

  };


  subscribeEvents();


  onAuthStateChanged(
    auth,
    onUser
  );


  hooks.ready();

}
