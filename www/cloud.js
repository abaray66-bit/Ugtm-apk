/* cloud.js – connexion Google et données partagées (Firebase).
   Ce module n'est chargé que si "firebase" est renseigné dans data.js.
   S'il ne peut pas se charger (hors connexion...), l'application continue de fonctionner avec data.js. */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { initializeAppCheck, ReCaptchaV3Provider } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, getRedirectResult, signInWithCredential,
  reauthenticateWithPopup, reauthenticateWithCredential, onAuthStateChanged, signOut as fbSignOut, deleteUser
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  onSnapshot, query, where, orderBy, limit, serverTimestamp, deleteField, runTransaction,
  writeBatch, arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getMessaging, getToken, onMessage } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js';

var auth, db, hooks, firebaseApp, messaging, fcmMessageBound = false;
var nativeAuth = null;
var capBrowser = null;
var APP_NOTIFICATION_ROOT = 'https://ugtm-fns-souss-massa.web.app/app.html';

function notificationTargetUrl(data){
  var target=new URL(APP_NOTIFICATION_ROOT);
  var info=data||{};
  var raw=info.targetUrl||info.url||'';
  if(raw){
    try{
      var candidate=new URL(String(raw),APP_NOTIFICATION_ROOT);
      if(candidate.origin===target.origin&&candidate.pathname===target.pathname)return candidate.href;
    }catch(e){}
  }
  var type=String(info.notificationType||info.targetType||'');
  var id=String(info.notificationId||info.targetId||'');
  if((type==='news'||type==='event'||type==='adhesion')&&id){
    target.searchParams.set('notificationType',type);
    target.searchParams.set('notificationId',id);
  }
  return target.href;
}

var unsubs = {
  member: null,
  members: null,
  news: null,
  reports: null,
  adhesions: null,
  responsables: null,
  notifications: null,
  publicProvinceContacts: null,
  adminEmails: null
};

var newsMode = null;

var session = {
  user: null,
  member: null,
  isAdmin: false
};

function showPushNotification(title, body, data){
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  var target=data||{};
  var stableKey=String(target.targetType||target.notificationType||target.type||'general')+'-'+String(target.targetId||target.notificationId||target.targetUid||target.id||'');
  var options = { body: String(body || ''), icon: 'icons/ugtm-mark.svg', tag: stableKey, renotify: false, data: { url: notificationTargetUrl(data) } };
  if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    navigator.serviceWorker.ready
      .then(function(registration){ return registration.showNotification(String(title || 'UGTM'), options); })
      .catch(function(){});
    return;
  }
  try { new Notification(String(title || 'UGTM'), options); } catch (e) {}
}

function ms(v){
  return (v && typeof v.toMillis === 'function') ? v.toMillis() : null;
}

function normalizeMember(d, uid){
  var name = d.name;
  if (name === undefined || name === null) name = '';
  if (typeof name === 'string' && name.indexOf('undefined') !== -1) name = name.replace(/undefined/g, '').replace(/\s+/g, ' ').trim();
  return {
    uid: uid,
    name: name,
    email: d.email || '',
    photo: d.photo || '',
    etab: d.etab || '',
    prov: d.prov || d.province || '',
    phone: d.phone || '',
    status: d.status || 'pending',
    memberNo: d.memberNo || '',
    role: d.role || 'member',
    adminProvince: d.adminProvince || d.province || '',
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
            createdAt: ms(x.createdAt),
            image: x.image || '',
            hasImage: !!(x.hasImage || x.image),
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
            ar: x.ar,
            hasImage: x.hasImage === true,
            imageCount: x.imageCount || 0
          };

        })
      );

    },

    function(err){
      hooks.error(err, true);
    }
  );
}


function subscribePublicProvinceContacts(){

  unsub('publicProvinceContacts');

  unsubs.publicProvinceContacts = onSnapshot(
    collection(db, 'publicProvinceContacts'),
    function(snap){
      hooks.setProvinceContacts(snap.docs.map(function(d){
        var x = d.data();
        return {
          province: x.province || d.id,
          name: x.name || '',
          phone: x.phone || ''
        };
      }));
    },
    function(err){ hooks.error(err, true); }
  );

}

/* =========================================================
   RESPONSABLES SYNDICAUX (permanence syndicale)
   La liste est publique : elle est affichée dans l'onglet Contact,
   sous « Permanence syndicale ». Seul l'admin peut désigner / retirer.
   ========================================================= */

function subscribeResponsables(){

  unsub('responsables');

  unsubs.responsables = onSnapshot(
    collection(db, 'responsables'),

    function(snap){

      hooks.setResponsables(
        snap.docs.map(function(d){

          var x = d.data() || {};

          return {
            uid: d.id,
            name: String(x.name || '').slice(0,120),
            title: String(x.title || '').slice(0,60),
            phone: String(x.phone || '').slice(0,30)
          };

        })
      );

    },

    function(){
      // Lecture publique indisponible (règles non publiées, hors ligne) : on masque la liste.
      hooks.setResponsables([]);
    }
  );

}


/* =========================================================
   SIGNALEMENTS
   ========================================================= */

function subscribeMembers(){
  unsub('members');
  if (!session.user || !(session.isAdmin || session.isSubAdmin)) { hooks.setMembers([]); return; }
  var adminProvince = String((session.member && session.member.adminProvince) || '');
  if (!session.isAdmin && !adminProvince) { hooks.setMembers([]); return; }
  var membersQuery = session.isAdmin
    ? collection(db, 'members')
    : query(collection(db, 'members'), where('prov', '==', adminProvince));
  unsubs.members = onSnapshot(membersQuery, function(snap){
    if(window.DEBUG) console.log('[Debug Admin] subscribeMembers: docs=', snap.docs.length, 'isAdmin=', session.isAdmin, 'isSubAdmin=', session.isSubAdmin);
    hooks.setMembers(snap.docs.map(function(d){return normalizeMember(d.data(), d.id);}));
  }, function(err){hooks.error(err);});
}

function reportProvinceLabel(code){

  var map = {
    agadir: 'Agadir Ida-Outanane',
    inezgane: 'Inezgane-Aït Melloul',
    chtouka: 'Chtouka-Aït Baha',
    taroudant: 'Taroudant',
    tiznit: 'Tiznit',
    tata: 'Tata'
  };

  return map[String(code || '')] || String(code || '');
}

/* =========================
   DEMANDES D'ADHÉSION — VUE RESPONSABLES
   Les dossiers sont lus par les seuls managers (admin ou sous-admin de la
   province portée par le dossier). L'adhérent lit le sien via
   getMyAdhesionRequest() : pas d'abonnement côté membre.
   ========================= */
function subscribeAdhesions(){
  unsub('adhesions');
  if (!session.user || !(session.isAdmin || session.isSubAdmin)) { hooks.setAdhesions([]); return; }
  var q;
  if (session.isAdmin) q = collection(db, 'adhesionRequests');
  else q = query(collection(db, 'adhesionRequests'), where('province', '==', String(session.member && session.member.adminProvince || '')));
  unsubs.adhesions = onSnapshot(q, function(snap){
    if(window.DEBUG) console.log('[Debug Admin] subscribeAdhesions: docs=', snap.docs.length, 'isAdmin=', session.isAdmin, 'province=', session.member && session.member.adminProvince);
    hooks.setAdhesions(snap.docs.map(function(d){
      var x = d.data();
      var app = x.application || {};
      return {
        id: d.id,
        uid: x.uid || '',
        province: x.province || '',
        status: x.status || 'pending',
        adminNote: x.adminNote || '',
        nom: app.nom || '', prenom: app.prenom || '', cin: app.cin || '',
        dob: app.dob || '', phone: app.phone || '',
        establishment: app.establishment || '', specialty: app.specialty || '',
        type: app.type || 'first', reason: app.reason || '', date: app.date || '',
        // Indicateurs de validation (les images de signature sont
        // récupérées à la demande dans getAdhesionDoc()).
        signed: !!x.adminSignature,
        signedBy: x.signedBy || '',
        signedAt: ms(x.signedAt),
        createdAt: ms(x.createdAt), updatedAt: ms(x.updatedAt)
      };
    }).sort(function(a,b){ return (b.createdAt||0)-(a.createdAt||0); }));
  }, function(err){ hooks.error(err, true); });
}

function subscribeReports(){

  unsub('reports');

  if (!session.user) return;

  var q;

  if (session.isAdmin){

    q = collection(db, 'reports');

  } else if (session.isSubAdmin) {

    q = query(
      collection(db, 'reports'),
      where('province', '==', reportProvinceLabel(session.member.adminProvince))
    );

  } else {

    // Simple adhérent : uniquement SES signalements identifiés.
    // Le filtre anonymous==false est INDISPENSABLE : sans lui, le moteur de
    // règles ne peut pas prouver « anonymous == false » à partir de la
    // requête et tout l'abonnement est refusé (permission-denied silencieux).
    q = query(
      collection(db, 'reports'),
      where('ownerUid', '==', session.user.uid),
      where('anonymous', '==', false)
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
            age: x.age || '',
            da: x.da || '',
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

/* =========================================================
   LISTE DES ADMINISTRATEURS (config/admins)
   Liste de secours : window.APP_DATA.adminEmails (data.js).
   Liste vivante : document config/admins, modifiable depuis
   l'espace administrateur sans redéploiement.
   ========================================================= */

function bootstrapAdminList(){
  return (hooks.adminEmails || []).map(function(x){
    return String(x).toLowerCase();
  });
}

function storedAdminList(snap){
  if (!snap || !snap.exists()) return [];
  var emails = snap.data() && snap.data().emails;
  if (!Array.isArray(emails)) return [];
  return emails.map(function(x){
    return String(x).toLowerCase();
  });
}

function mergedAdminList(stored){
  var out = bootstrapAdminList();
  (stored || []).forEach(function(x){
    if (out.indexOf(x) < 0) out.push(x);
  });
  return out;
}

function isAdminUser(user, stored){
  if (!user || !user.emailVerified) return false;
  return mergedAdminList(stored).indexOf((user.email || '').toLowerCase()) >= 0;
}

/* Abonnement léger à config/admins : un administrateur ajouté ou retiré
   prend effet immédiatement côté règles et, ici, côté interface. */
function subscribeAdminEmails(user){

  unsub('adminEmails');

  if (!user) return;

  unsubs.adminEmails = onSnapshot(
    doc(db, 'config', 'admins'),
    function(snap){
      var stored = storedAdminList(snap);
      var isAdmin = isAdminUser(user, stored);
      if(window.DEBUG) console.log('[Debug Admin] subscribeAdminEmails: stored=', stored, 'isAdmin=', isAdmin, 'session.isAdmin=', session.isAdmin, 'userEmail=', user && user.email);
      if (isAdmin !== session.isAdmin){
        session.isAdmin = isAdmin;
        if (isAdmin) syncPublicProvinceContacts();
        hooks.setSession(session);
         if (isAdmin){
            subscribeMembers();
            subscribeReports();
            subscribeAdhesions();
            subscribeNews();
         }
        }
      if (hooks.setAdminEmails && typeof hooks.setAdminEmails === 'function'){
        try { hooks.setAdminEmails(mergedAdminList(stored)); } catch (e) {}
      }
    },
    function(){ /* liste absente ou illisible : data.js reste la référence */ }
  );
}

function onUser(user){

  unsub('member');
  unsub('members');
  unsub('adminEmails');

  if (!user){

    unsub('reports');
    unsub('adhesions');
    unsub('notifications');

    session = {
      user: null,
      member: null,
      isAdmin: false,
      isSubAdmin: false
    };

    hooks.setSession(session);
    hooks.setMembers([]);
    hooks.setReports([]);
    hooks.setAdhesions([]);

    subscribeNews();

    return;
  }


  // Jeton périmé = appareil muet : on le réenregistre dès la connexion quand
  // l'autorisation de notification est déjà accordée.
  try { if (typeof refreshPushTokenQuietly === "function") refreshPushTokenQuietly(user); } catch(e) { console.warn("push refresh:", e); }

  /* Décision immédiate sur la liste de secours (data.js) : disponible
     sans attendre Firestore. L'abonnement config/admins affine ensuite. */
  var isAdmin = isAdminUser(user, null);

  if (isAdmin) syncPublicProvinceContacts();

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

  // FCM ne demande jamais la permission automatiquement après connexion :
  // Chrome Android exige une action explicite de l'utilisateur.
  try {
    if (typeof Notification !== 'undefined') {
      messaging = messaging || getMessaging(firebaseApp);
      if (!fcmMessageBound) {
        fcmMessageBound = true;
        onMessage(messaging, function(payload) {
          var n = (payload && payload.notification) || {};
          showPushNotification(n.title || 'UGTM', n.body || '', (payload && payload.data) || {});
        });
      }
    }
  } catch (e) {
    try { console.warn('FCM init failed:', e && e.code ? e.code : 'unknown'); } catch (_e) {}
  }

  // Notifications temps réel : badge + alerte locale.
  unsub('notifications');
  try {
    unsubs.notifications = onSnapshot(
      collection(db, 'notifications', user.uid, 'items'),
      function(snap){
        var unread = snap.docs.filter(function(d){ var x=d.data()||{}; return x.read !== true; }).length;
        if(typeof window.updateNotifBadge === 'function') window.updateNotifBadge(unread);

      }
    );
  } catch(e){}

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
          .then(function(){
            /* Premier enregistrement du profil : l'application
               ouvre automatiquement le formulaire d'adhésion
               (hook onFirstProfile, cf. app.html). */
            if (hooks && typeof hooks.onFirstProfile === 'function'){
              try { hooks.onFirstProfile(user); } catch (e) {}
            }
          })
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
      subscribeAdhesions();

    },

    function(err){
      hooks.error(err);
    }

  );


  subscribeMembers();


  subscribeNews();
  subscribeReports();
  subscribeAdhesions();

  subscribeAdminEmails(user);

}


/* =========================================================
   GOOGLE LOGIN
   ========================================================= */

/* Un appel natif peut ne jamais se terminer (selecteur de comptes
   silencieux, Google Play Services en retard) : sans delai maximum le
   bouton reste bloque sans le moindre message. */
function withTimeout(promise, ms, message){

  return new Promise(function(resolve, reject){

    var settled = false;

    var timer = setTimeout(function(){

      if (settled) return;

      settled = true;

      var error = new Error(message);
      error.timeout = true;
      reject(error);

    }, ms);


    promise.then(function(value){

      if (settled) return;

      settled = true;
      clearTimeout(timer);
      resolve(value);

    }, function(error){

      if (settled) return;

      settled = true;
      clearTimeout(timer);
      reject(error);

    });

  });

}


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


      var result;

      try {

        result = await withTimeout(
          nativeAuth.signInWithGoogle({

            useCredentialManager: true,
            skipNativeAuth: true

          }),
          25000,
          "Google ne répond pas (délai dépassé)."
        );

      } catch (first) {

        if (!first || !first.timeout) throw first;

        // Credential Manager est resté muet : on repasse par le sélecteur
        // de comptes classique, qui est la seule issue sur ces appareils.
        hooks.error({ code: 'sélecteur Google bloqué, nouvelle tentative' });

        result = await withTimeout(
          nativeAuth.signInWithGoogle({

            useCredentialManager: false,
            skipNativeAuth: true

          }),
          40000,
          "Le sélecteur de comptes Google ne s'est pas ouvert. Vérifiez que Google Play Services et Chrome sont à jour."
        );

      }


      var idToken =
        result && result.credential && result.credential.idToken;


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


    try {
      await signInWithPopup(
        auth,
        provider
      );
    } catch (e) {
      // Ne relancer que si le navigateur a bloqué la fenêtre : relancer après
      // une fermeture volontaire rouvrait une popup que l'utilisateur venait
      // de fermer, ce qui donne l'impression que la connexion est cassée.
      if (e && e.code === 'auth/popup-blocked') {
        try { await signInWithPopup(auth, provider); return; } catch(e2){ throw e2; }
      }
      throw e;
    }

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

    // Personne ne rattrape la promesse de signIn() : lancer l'erreur ne
    // produisait AUCUN message et le bouton semblait simplement inerte.
    var reason = String((e && (e.message || e.code)) || e || '');
    if (/referer|referrer|API_KEY_HTTP_REFERRER_BLOCKED/i.test(reason)) {
      hooks.error({
        code: 'connexion refusée par Firebase : origine de l’application non autorisée (https://localhost). Autorisez https://localhost/* et capacitor://localhost/* dans les restrictions par référent de votre clé API Firebase.'
      });
      return;
    }

    hooks.error(e);
    return;

  }

}


/* =========================================================
   DECONNEXION
   ========================================================= */

async function signOut(){

  // Fermer d'abord la session Firebase.
  await fbSignOut(auth);

  // La déconnexion native est secondaire et ne doit pas empêcher
  // la fermeture de la session Firebase.
  if (
    nativeAuth &&
    window.Capacitor &&
    window.Capacitor.isNativePlatform &&
    window.Capacitor.isNativePlatform()
  ){
    try {
      await nativeAuth.signOut();
    }
    catch(e){
      console.warn('Déconnexion native Google non terminée :',e);
    }
  }

}


/* =========================================================
   AJOUT SIGNALEMENT
   ========================================================= */

async function addReport(o){

  var anonymous = !!o.anonymous;

  if (!auth.currentUser && !anonymous)
    throw new Error('Non connecté');

  var attachments = Array.isArray(o.attachments) ? o.attachments : (o.attachmentData ? [o.attachmentData] : []);
  attachments = attachments.slice(0,3).filter(function(x){ return x; });

  var data = {
    ownerUid: anonymous ? '' : auth.currentUser.uid,
    anonymous: anonymous,
    name: anonymous ? '' : String(o.name || '').slice(0,120),
    etab: String(o.etab || '').slice(0,160),
    age: anonymous ? '' : String(o.age || '').slice(0,10),
    da: String(o.da || '').slice(0,80),
    category: String(o.category || '').slice(0,60),
    description: String(o.description || '').slice(0,4000),
    date: String(o.date || '').slice(0,20),
    province: String(
      reportProvinceLabel(o.province || (session.member ? session.member.prov || '' : ''))
    ).slice(0,40),
    attachmentName: String((attachments[0] && attachments[0].name) || o.attachmentName || '').slice(0,120),
    attachmentCount: attachments.length,
    attachmentType: String((attachments[0] && attachments[0].type) || o.attachmentType || '').slice(0,80),
    attachmentData: '',
    status: 'new',
    response: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  var reportRef = doc(collection(db, 'reports'));
  var batch = writeBatch(db);

  batch.set(reportRef, data);

  attachments.forEach(function(att, idx){
    batch.set(doc(db, 'reportAttachments', reportRef.id + '_' + idx), {
      data: String(att.data||'').slice(0,420000),
      name: String(att.name || '').slice(0,120),
      type: String(att.type || '').slice(0,80),
      ownerUid: data.ownerUid,
      anonymous: data.anonymous,
      province: data.province,
      createdAt: serverTimestamp()
    });
  });

  return batch.commit().then(function(){
    return reportRef;
  });
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
      var contactRef = doc(db, 'provinceContacts', snap.data().adminProvince);
      var contactSnap = await getDoc(contactRef);
      if (contactSnap.exists() && contactSnap.data().uid === u.uid){
        await updateDoc(contactRef, {
          name: fields.name,
          phone: fields.phone
        });
        await savePublicProvinceContact(snap.data().adminProvince, fields.name, fields.phone);
      }
    }

  }

}


/* =========================================================
   DEMANDES D'ADHÉSION NUMÉRIQUES — une demande par UID
   ========================================================= */
async function getMyAdhesionRequest(){
   var u=auth.currentUser;
   if(!u) throw new Error('Connectez-vous pour consulter votre demande.');
   var snap=await getDoc(doc(db,'adhesionRequests',u.uid));
   if(!snap.exists()) return null;
   var x=snap.data()||{};
   return {id:snap.id,status:x.status||'pending',province:x.province||'',createdAt:ms(x.createdAt),updatedAt:ms(x.updatedAt),adminNote:x.adminNote||'',signedAt:ms(x.signedAt),application:x.application||{}};
 }
async function submitAdhesion(application,signature){
  var u=auth.currentUser;
  if(!u) throw new Error('Connectez-vous avant d’envoyer votre demande.');
  if(!application||typeof application!=='object') throw new Error('Dossier incomplet.');
  var uid=u.uid, requestRef=doc(db,'adhesionRequests',uid);
  var clean={
    nom:String(application.nom||'').trim().slice(0,100),prenom:String(application.prenom||'').trim().slice(0,100),
    cin:String(application.cin||'').trim().slice(0,30),dob:String(application.dob||'').slice(0,10),
    phone:String(application.phone||'').trim().slice(0,30),address:String(application.address||'').trim().slice(0,250),
    province:String(application.province||'').slice(0,40),establishment:String(application.establishment||'').trim().slice(0,160),
    service:String(application.service||'').trim().slice(0,120),function:String(application.function||'').trim().slice(0,120),
    specialty:String(application.specialty||'').trim().slice(0,120),ppr:String(application.ppr||'').trim().slice(0,30),
    type:application.type==='renewal'?'renewal':'first',reason:String(application.reason||'').trim().slice(0,200),commitment:application.commitment===true,date:String(application.date||'').slice(0,10)
  };
  if(!clean.nom||!clean.prenom||!clean.cin||!clean.dob||!clean.phone||!clean.address||!clean.province||!clean.establishment||!clean.function||!clean.commitment||!application.signature)
    throw new Error('Des champs obligatoires ou la signature sont manquants.');
  if(clean.type==='renewal'&&!clean.reason) throw new Error('Veuillez préciser le motif du renouvellement.');
  if(clean.type==='first')clean.reason='';
  var sig=String(signature||'');
  if(!sig) throw new Error('La signature est manquante.');
  if(sig.length>20000) throw new Error('La signature est trop volumineuse. Signez à nouveau.');
  var result = await runTransaction(db,async function(tx){
    var reqSnap=await tx.get(requestRef);
    var existing=reqSnap.exists()?reqSnap.data():null;
    var status=existing?String(existing.status||'pending'):'';
    /* RENOUVELLEMENT : un adhérent déjà accepté peut redéposer son
       dossier, mais uniquement en type 'renewal' avec un motif — le
       dossier repasse alors en attente de validation (cf. firestore.rules). */
    var renewalAccepted=status==='accepted'&&clean.type==='renewal'&&!!clean.reason;
    if(existing&&status!=='needs_completion'&&!renewalAccepted){
      var messages={pending:'Votre demande est déjà enregistrée et en attente de traitement.',accepted:'Votre adhésion est déjà acceptée : renouvelez-la avec un motif depuis le formulaire.',refused:'Une décision a déjà été prise concernant votre demande.'};
      var err=new Error(messages[status]||'Une demande existe déjà pour ce compte.');err.code='adhesion/already-exists';err.status=status;throw err;
    }
    if(existing&&existing.uid!==uid) throw new Error('Le dossier existant ne correspond pas à votre compte.');
    if(existing&&existing.province!==clean.province) throw new Error('La province du dossier ne peut pas être modifiée pendant un complément.');
    if(existing){
      /* NOUVELLE SOUMISSION (complément d'information ou renouvellement) :
         la signature du responsable de la soumission précédente est
         effacée. Le dossier repart avec UNE seule signature — celle de
         l'adhérent — et la case du responsable à valider. */
      tx.update(requestRef,{application:clean,signature:sig,status:'pending',adminNote:'',adminSignature:'',signedBy:'',signedAt:'',updatedAt:serverTimestamp()});
    }else{
      tx.set(requestRef,{uid:uid,email:String(u.email||'').slice(0,254),province:clean.province,application:clean,signature:sig,status:'pending',adminNote:'',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    }
    return {id:uid,status:'pending',completed:!!existing};
  }).then(async function(result){
    /* Le formulaire d'adhésion est la saisie de
       référence du téléphone (le formulaire de profil
       a été retiré) : le numéro saisi est reporté sur
       la fiche membre, puis — quand le compte en porte
       un — sur la fiche de responsable et le contact de
       province (liste publique). */

    /* Synchroniser aussi la province sur le profil membre dès
       la soumission, afin que le dossier apparaisse avec sa
       province avant même d'être validé par un responsable. */
    if (clean.province) {
      try {
        await updateDoc(doc(db,'members',uid), {
          prov: String(clean.province||'').trim(),
          adminProvince: String(clean.province||'').trim(),
          updatedAt: serverTimestamp()
        });
      } catch(e){ console.warn('syncMemberProvince:', e); }
    }

    return syncMemberPhone(u, clean.phone).then(function(){
      if (!result.completed) {
        var applicantName = (clean.prenom + ' ' + clean.nom).trim();
        var isRenewal = clean.type === 'renewal';
        window.cloudSendPush(
          isRenewal ? 'adhesion_renewal' : 'adhesion_request',
          isRenewal ? 'Renouvellement d’adhésion : ' + applicantName : 'Nouvelle demande d’adhésion : ' + applicantName,
          'Province : ' + clean.province,
          uid
        );
        /* Notification aux administrateurs (écriture Firestore pour affichage
           dans la liste des notifications de l’application). */
        var adminEmails = (hooks && hooks.adminEmails) || [];
        if(adminEmails.length){
          var adminQuery = query(collection(db,'members'), where('email','in',adminEmails));
          getDocs(adminQuery).then(function(snap){
            snap.docs.forEach(function(dSnap){
              var adminUid = dSnap.id;
              addDoc(collection(db,'notifications',adminUid,'items'), {
                title: isRenewal ? 'Renouvellement d’adhésion : ' + applicantName : 'Nouvelle demande d’adhésion : ' + applicantName,
                body: 'Province : ' + clean.province,
                type: isRenewal ? 'adhesion_renewal' : 'adhesion_request',
                read: false,
                authorUid: uid,
                createdAt: serverTimestamp(),
                targetScreen: 'admin',
                targetId: String(uid),
                province: clean.province
              });
            });
          }).catch(function(e){ console.warn('notif admin:', e); });
        }
      }
      return result;
    }).catch(function(e){
      console.warn('syncMemberPhone:', e);
      if (!result.completed) {
        var applicantName = (clean.prenom + ' ' + clean.nom).trim();
        var isRenewal = clean.type === 'renewal';
        window.cloudSendPush(
          isRenewal ? 'adhesion_renewal' : 'adhesion_request',
          isRenewal ? 'Renouvellement d’adhésion : ' + applicantName : 'Nouvelle demande d’adhésion : ' + applicantName,
          'Province : ' + clean.province,
          uid
        );
      }
      return result;
    });
  });
  return result;
}

/* =========================================================
   SIGNATURE ÉLECTRONIQUE DU RESPONSABLE
   L'administrateur (ou le sous-admin de la province) signe la
   demande dans l'application : la signature VALIDE l'adhésion
   (statut 'accepted'). Le dossier signé par l'adhérent n'est
   jamais réécrit (cf. firestore.rules).
   ========================================================= */
async function signAdhesion(uid,signature,note){
  var u=auth.currentUser;
  if(!u) throw new Error('Non connecté');
  var sig=String(signature||'');
  if(!sig) throw new Error('La signature du responsable est manquante.');
  if(sig.length>20000) throw new Error('La signature est trop volumineuse. Signez à nouveau.');
await updateDoc(doc(db,'adhesionRequests',String(uid)),{
     status:'accepted',
     adminSignature:sig,
     signedBy:u.uid,
     signedAt:serverTimestamp(),
     adminNote:String(note||'').slice(0,1000),
     updatedAt:serverTimestamp()
   });
   await activateMemberFromRequest(uid);
   try {
      var reqForNotif = await getDoc(doc(db,'adhesionRequests',String(uid)));
      var provForNotif = (reqForNotif.exists() && reqForNotif.data() && reqForNotif.data().province) ? String(reqForNotif.data().province) : '';
      if (!provForNotif) {
        var memberSnap = await getDoc(doc(db,'members',String(uid)));
        if (memberSnap.exists() && memberSnap.data() && memberSnap.data().prov) {
          provForNotif = String(memberSnap.data().prov);
        }
      }
      if (!provForNotif) {
        throw new Error('Province manquante pour la notification d\'adhésion uid=' + String(uid));
      }
      await addDoc(collection(db,'notifications',String(uid),'items'), {
        title:'Adhésion acceptée',
        body:'Votre adhésion a été validée.',
        type:'adhesion',
        read:false,
        authorUid:u.uid,
        createdAt:serverTimestamp(),
        targetScreen:'me',
        targetId:String(uid),
        province:provForNotif
      });
      // Push via backend (best-effort).
      getDoc(doc(db, 'fcmTokens', String(uid))).then(function(tokSnap){
        var tok = tokSnap.exists() && tokSnap.data() && tokSnap.data().token;
        window.cloudSendPush('adhesion', 'Adhésion acceptée', 'Votre adhésion a été validée.', String(uid));
      }).catch(function(){});
    } catch(e){ console.warn('notif create', e); }
   return sig;
 }
 
 /* =========================================================
    ACTIVATION D'UN MEMBRE À PARTIR D'UNE DEMANDE D'ADHESION
    Transforme une demande d'adhésion acceptée en membre actif
    avec un numéro d'adhérent SM-XXXX depuis le compteur global.
    ========================================================= */
async function activateMemberFromRequest(uid){
  var ref = doc(db, 'members', uid);
  var snap = await getDoc(ref);
  var member = snap.exists() ? snap.data() : null;
  var reqRef = doc(db, 'adhesionRequests', uid);
  var reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) {
    throw new Error('Dossier d’adhésion introuvable');
  }
  var req = reqSnap.data();
  if (req.status !== 'accepted') {
    throw new Error('Le dossier n’est pas encore accepté');
  }
  var app = req.application || {};
  if (!app.nom || !app.prenom || !app.cin || !app.dob) {
    throw new Error('Application d’adhésion incomplète');
  }
  var name = String(app.prenom||'').trim() + ' ' + String(app.nom||'').trim();
  name = name.trim();
  var data = {
    name: name,
    email: req.email||'',
    photo: '',
    etab: String(app.establishment||'').trim(),
    prov: String(app.province||'').trim(),
    phone: String(app.phone||'').trim(),
    status: 'active',
    memberNo: '',
    role: 'member',
    adminProvince: String(app.province||'').trim(),
    createdAt: serverTimestamp(),
    activatedAt: serverTimestamp()
  };
  var no = '';
  if (member && member.status === 'active') {
    no = member.memberNo || '';
    var upd = { updatedAt: serverTimestamp() };
    if (app.province) { upd.prov = String(app.province||'').trim(); upd.adminProvince = String(app.province||'').trim(); }
    await updateDoc(ref, upd);
  } else {
    if (app.province) data.prov = String(app.province||'').trim();
    if (app.province) data.adminProvince = String(app.province||'').trim();
    if (app.establishment) data.etab = String(app.establishment||'').trim();
    if (app.phone) data.phone = String(app.phone||'').trim();
    var seqRef = doc(db, 'counters', 'memberNumbers');
    var seed = 1;
    var seq0 = await getDoc(seqRef);
    if (!seq0.exists()) {
      var maxNo = 0;
      var allMembers = await getDocs(collection(db, 'members'));
      allMembers.forEach(function(d){
        var m = /(\d+)\s*$/.exec(String((d.data() || {}).memberNo || ''));
        if (m) maxNo = Math.max(maxNo, +m[1]);
      });
      if (maxNo > 0) seed = maxNo + 1;
    }
    no = 'SM-' + String(Math.floor(seed)).padStart(4, '0');
    await runTransaction(db, async function(tx){
      var seqSnap = await tx.get(seqRef);
      var next = seqSnap.exists() ? Number(seqSnap.data().next || 1) : seed;
      if (!Number.isFinite(next) || next < 1) next = 1;
      tx.set(seqRef, {
        next: Math.floor(next) + 1,
        lastMemberNo: no,
        memberUid: uid,
        updatedAt: serverTimestamp()
      });
      tx.set(ref, {...data, memberNo: no});
    });
  }
  await updateDoc(reqRef, {signedAt: serverTimestamp(), updatedAt: serverTimestamp()});
  return no;
}

/* =========================================================
   SYNCHRONISATION DU TÉLÉPHONE SAISI DANS LA DEMANDE D'ADHÉSION
   Le numéro est reporté sur la fiche membre, puis — quand le
   compte en porte un — sur la fiche de responsable (permanence
   syndicale) et le contact de province (sous-admin), publics.
   ========================================================= */
async function syncMemberPhone(u, phone){
  var uid=u.uid;
  var tel=String(phone||'').trim().slice(0,30);
  if(!tel)return;
  var ref=doc(db,'members',uid);
  var snap=await getDoc(ref);
  if(!snap.exists())return;
  var data=snap.data()||{};
  var name=String(data.name||'').slice(0,120);
  await updateDoc(ref,{phone:tel,updatedAt:serverTimestamp()});
  if(data.role==='subadmin'&&data.adminProvince){
    var cref=doc(db,'provinceContacts',data.adminProvince);
    var csnap=await getDoc(cref);
    if(csnap.exists()&&csnap.data().uid===uid){
      await updateDoc(cref,{name:name,phone:tel});
      await savePublicProvinceContact(data.adminProvince,name,tel);
    }
  }
  var rref=doc(db,'responsables',uid);
  var rsnap=await getDoc(rref);
  if(rsnap.exists()){
    await updateDoc(rref,{name:name,phone:tel});
  }
}

/* =========================================================
   PDF OFFICIEL — généré par un responsable, stocké à côté du dossier
   Le PDF n'est écrit que sur action explicite d'un responsable
   habilité, et uniquement pour une demande déjà signée (les règles
   Firestore vérifient le statut 'accepted' et la province).
   ========================================================= */
async function getAdhesionDoc(uid){
  var snap=await getDoc(doc(db,'adhesionRequests',String(uid)));
  /* id = identifiant du document Firestore : c'est la référence unique
     et la provenance du dossier, affichée sur le PDF officiel. */
  return snap.exists()?Object.assign({},snap.data(),{id:snap.id}):null;
}
/* Nom du fichier PDF d'un dossier : « UGTM- Nom Prénom.pdf ».
   L'adhérent est identifié directement, sans passer par un code technique. */
function adhesionPdfFileName(doc){
  var a=(doc&&doc.application)||{};
  var base=(String(a.nom||'').trim()+' '+String(a.prenom||'').trim()).replace(/\s+/g,' ').trim();
  base=base.replace(/[\\/:*?"<>|]/g,' ').replace(/\s+/g,' ').trim();
  if(!base)base='demande-adhesion';
  if(base.length>100)base=base.slice(0,100).trim();
  return 'UGTM- '+base+'.pdf';
}
async function saveAdhesionPdf(uid,pdfBase64,fileName){
  var u=auth.currentUser;
  if(!u) throw new Error('Non connecté');
  var uidStr=String(uid||'');
  var b64=String(pdfBase64||'');
  if(!uidStr) throw new Error('Dossier introuvable.');
  if(!b64) throw new Error('PDF vide : génération impossible.');
  if(b64.length>650000) throw new Error('Le PDF dépasse la taille maximale autorisée (650 Ko).');
  var request=await getAdhesionDoc(uidStr);
  var province=request?request.province:'';
  if(!province) throw new Error('Dossier introuvable.');
  /* Nom du fichier : « UGTM- Nom Prénom.pdf » (borné par les règles
     Firestore à 120 caractères). */
  var name=String(fileName||adhesionPdfFileName(request)||'');
  if(name.length>120) name=name.slice(0,120);
  if(!name) name='demande-adhesion-'+uidStr+'.pdf';
  return setDoc(doc(db,'adhesionDocuments',uidStr),{
    uid:uidStr,
    province:province,
    fileName:name,
    mimeType:'application/pdf',
    data:b64,
    createdAt:serverTimestamp(),
    updatedAt:serverTimestamp()
  });
}

/* Récupération du PDF officiel enregistré (responsables habilités) :
   le contenu, son nom de fichier et sa date d'enregistrement — cette
   date permet de ne pas resservir un PDF périmé (renouvellement). */
function getSavedAdhesionPdf(uid){
  return getDoc(doc(db,'adhesionDocuments',String(uid||''))).then(function(s){
    if(!s.exists())return null;
    var d=s.data()||{};
    return {data:String(d.data||''),fileName:String(d.fileName||''),updatedAt:ms(d.updatedAt)};
  }).catch(function(){return null;});
}

/* =========================================================
   SUPPRESSION COMPTE
   ========================================================= */

async function reauthenticateForAccountDeletion(u){

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

    var result = await nativeAuth.signInWithGoogle({
      useCredentialManager: true,
      skipNativeAuth: true
    });

    var idToken =
      result && result.credential && result.credential.idToken;
    if (!idToken){
      throw new Error("Google n'a pas fourni de jeton d'authentification.");
    }

    await reauthenticateWithCredential(
      u,
      GoogleAuthProvider.credential(idToken)
    );
    return;
  }

  var provider = new GoogleAuthProvider();
  provider.setCustomParameters({prompt: 'select_account'});
  await reauthenticateWithPopup(u, provider);
}


async function deleteAccount(){

  var u = auth.currentUser;
  if (!u) throw new Error('Non connecté');

  var memberRef = doc(db, 'members', u.uid);
  var memberSnap = await getDoc(memberRef);
  var member = memberSnap.exists() ? memberSnap.data() : {};

  // Un administrateur de province (sous-admin) ne peut pas supprimer son
  // compte : son mandat est révocable par l'administrateur principal seul.
  // On bloque AVANT la réauthentification et toute suppression de données,
  // et les règles Firestore refusent également la suppression du profil.
  if (member.role === 'subadmin'){
    throw new Error(
      "Le compte administrateur de province ne peut pas être supprimé. Contactez l'administrateur principal."
    );
  }

  // Réauthentifier avant toute suppression de données, pour éviter de laisser
  // un compte actif sans profil si Firebase exige une connexion récente.
  await reauthenticateForAccountDeletion(u);

  unsub('member');
  unsub('members');
  unsub('reports');

  // Les signalements soumis ne sont pas supprimés par la suppression du compte.
  await deleteDoc(doc(db, 'responsables', u.uid));
  if (memberSnap.exists()) await deleteDoc(memberRef);

  // Ne pas masquer les erreurs : l'interface doit distinguer une suppression réussie d'un échec.
  await deleteUser(u);
}


/* =========================================================
    ADMINISTRATION
    ========================================================= */

function savePublicProvinceContact(province, name, phone){
  var provKey=String(province || '').toLowerCase();
  var contactName=String(name || '').trim();
  // Ne pas enregistrer le nom de la province (ou son code) comme nom du responsable
  if(contactName && (contactName.toLowerCase()===provKey || contactName===province)) contactName='';
  return setDoc(doc(db, 'publicProvinceContacts', province), {
    province: String(province || '').slice(0,40),
    name: contactName.slice(0,120),
    phone: String(phone || '').slice(0,30)
  });
}

function deletePublicProvinceContact(province){
  return deleteDoc(doc(db, 'publicProvinceContacts', province));
}

function syncPublicProvinceContacts(){
  return getDocs(collection(db, 'provinceContacts')).then(function(privateSnap){
    var active = {};
    var writes = privateSnap.docs.map(function(d){
      var x = d.data();
      active[d.id] = true;
      return savePublicProvinceContact(d.id, x.name, x.phone);
    });
    return Promise.all(writes).then(function(){
      return getDocs(collection(db, 'publicProvinceContacts'));
    }).then(function(publicSnap){
      var removals = publicSnap.docs.filter(function(d){return !active[d.id];}).map(function(d){return deletePublicProvinceContact(d.id);});
      return Promise.all(removals);
    });
  }).catch(function(e){hooks.error(e, true);});
}
var admin = {

  /* ----------------------------------------------------
     ADMINISTRATEURS (config/admins)
     La liste de secours (data.js) ne peut pas être retirée
     depuis l'application : la règle Firestore l'exige aussi.
     ---------------------------------------------------- */

  getAdminEmails:
    function(){
      return getDoc(doc(db, 'config', 'admins')).then(function(snap){
        return mergedAdminList(storedAdminList(snap));
      }).catch(function(){
        return mergedAdminList(null);
      });
    },

  addAdminEmail:
    function(email){
      var e = String(email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e))
        return Promise.reject(new Error('Adresse e-mail invalide.'));

      return getDoc(doc(db, 'config', 'admins')).then(function(snap){
        var stored = storedAdminList(snap);
        if (mergedAdminList(stored).indexOf(e) >= 0)
          throw new Error('Cette adresse est déjà administrateur.');
        if (stored.length >= 10)
          throw new Error('10 adresses administrateur au maximum (hors liste de secours).');

        /* La règle exige que la liste stockée contienne la liste de
           secours : on la joint à la première écriture. */
        bootstrapAdminList().forEach(function(b){
          if (stored.indexOf(b) < 0) stored.push(b);
        });

        stored.push(e);

        return setDoc(doc(db, 'config', 'admins'), {
          emails: stored,
          updatedAt: serverTimestamp()
        });
      });
    },

  removeAdminEmail:
    function(email){
      var e = String(email || '').trim().toLowerCase();
      if (bootstrapAdminList().indexOf(e) >= 0)
        return Promise.reject(new Error(
          'Cette adresse fait partie de la liste de secours : elle se retire dans www/data.js, pas ici.'
        ));

      return getDoc(doc(db, 'config', 'admins')).then(function(snap){
        var stored = storedAdminList(snap);
        var next = stored.filter(function(x){ return x !== e; });
        if (next.length === stored.length)
          throw new Error('Cette adresse n\'est pas dans la liste.');
        return setDoc(doc(db, 'config', 'admins'), {
          emails: next,
          updatedAt: serverTimestamp()
        });
      });
    },

  setSubAdmin:
    function(uid, province){
      return runTransaction(db, async function(tx){
        var memberRef = doc(db, 'members', uid);
        var memberSnap = await tx.get(memberRef);
        if (!memberSnap.exists()) throw new Error('Membre introuvable');
        var member = memberSnap.data();
        if (member.status !== 'active') throw new Error('Seul un adhérent actif peut devenir sous-admin.');
        if (!String(member.phone || '').trim()) throw new Error('Ce membre n\'a pas renseigné de téléphone : il doit d\'abord le saisir dans sa demande d\'adhésion pour figurer dans la liste publique des responsables de province.');

        var assigned = String(province || '').slice(0,40);
        var old = member.adminProvince || '';

        var contactRef = doc(db, 'provinceContacts', assigned);
        var contactSnap = await tx.get(contactRef);
        if (contactSnap.exists() && contactSnap.data().uid !== uid)
          throw new Error('Un sous-admin est déjà affecté à ce secteur. Retirez son rôle avant de le remplacer.');

        tx.update(doc(db, 'members', uid), {role: 'subadmin', adminProvince: assigned});

        if (old && old !== assigned){
          var oldRef = doc(db, 'provinceContacts', old);
          var oldSnap = await tx.get(oldRef);
          if (oldSnap.exists() && oldSnap.data().uid === uid) {
            tx.delete(doc(db, 'provinceContacts', old));
            tx.delete(doc(db, 'publicProvinceContacts', old));
          }
        }

        tx.set(doc(db, 'provinceContacts', assigned), {
          uid: uid,
          name: String(member.name || '').slice(0,120),
          phone: String(member.phone || '').slice(0,30),
          province: assigned,
          updatedAt: serverTimestamp()
        });

        return {old: old, assigned: assigned, name: member.name, phone: member.phone};
      }).then(function(res){
        return res;
      }).then(function(res){
        return savePublicProvinceContact(res.assigned, res.name, res.phone);
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
          if (contact.exists() && contact.data().uid === uid) return deleteDoc(doc(db, 'provinceContacts', old)).then(function(){return deletePublicProvinceContact(old);});
        });
      });
    },

  getSubAdminContact:
    function(province){
      return getDoc(doc(db, 'provinceContacts', province)).then(function(snap){
        return snap.exists() ? snap.data() : null;
      });
    },

  setResponsable:
    function(uid, title){
      return getDoc(doc(db, 'members', uid)).then(function(snap){
        if (!snap.exists()) throw new Error('Membre introuvable');
        var member = snap.data();
        if (member.status !== 'active')
          throw new Error('Seul un adhérent actif peut être désigné responsable.');
        return setDoc(doc(db, 'responsables', uid), {
          uid: uid,
          name: String(member.name || member.email || '').slice(0,120),
          title: String(title || '').slice(0,60),
          phone: String(member.phone || '').slice(0,30),
          createdAt: serverTimestamp()
        });
      });
    },

  removeResponsable:
    function(uid){
      return deleteDoc(doc(db, 'responsables', uid));
    },


  setStatus:
    async function(uid, status){
      var ref = doc(db, 'members', uid);
      var snap = await getDoc(ref);

      if (!snap.exists())
        throw new Error('Membre introuvable');

      var prior = snap.data();

      /* Attribution automatique du numéro d'adhérent */
      if (status === 'active' && !prior.memberNo){
        var sequenceRef = doc(db, 'counters', 'memberNumbers');

        /* Initialisation du compteur s'il n'existe pas encore : on repart
           du plus grand numéro déjà attribué + 1 pour ne jamais réattribuer
           un numéro existant. Une requête ne passe pas dans une transaction
           Web : la lecture a lieu AVANT, et la transaction re-lit le
           compteur — si un autre l'a créé entre-temps, sa valeur gagne :
           l'atomicité reste donc garantie. Un sous-admin ne voit que sa
           province (la requête globale est refusée) : retombée sur 1 — la
           migration fiable se fait en faisant initialiser le compteur par
           l'administrateur principal (cf. firestore.rules/counters). */
        var seed = 1;
        var seq0 = await getDoc(sequenceRef);
        if (!seq0.exists()){
          try {
            var maxNo = 0;
            var allMembers = await getDocs(collection(db, 'members'));
            allMembers.forEach(function(d){
              var m = /(\d+)\s*$/.exec(String((d.data() || {}).memberNo || ''));
              if (m) maxNo = Math.max(maxNo, +m[1]);
            });
            if (maxNo > 0) seed = maxNo + 1;
          } catch (e) {
            /* Lecture globale refusée (sous-admin) : retombée sur 1. */
          }
        }

        return runTransaction(db, async function(tx){
          var seqSnap = await tx.get(sequenceRef);

          var next = seqSnap.exists()
            ? Number(seqSnap.data().next || 1)
            : seed;

          if (!Number.isFinite(next) || next < 1)
            next = 1;

          var no = 'SM-' + String(Math.floor(next)).padStart(4, '0');

          tx.set(sequenceRef, {
            next: Math.floor(next) + 1,
            lastMemberNo: no,
            memberUid: uid,
            updatedAt: serverTimestamp()
          });

          tx.update(ref, {
            status: 'active',
            memberNo: no,
            activatedAt: serverTimestamp()
          });

          return no;
        });
      }

      var data = {status: status};

      if (status !== 'active' && prior.role === 'subadmin'){
        data.role = 'member';
        data.adminProvince = '';
      }

      return updateDoc(ref, data).then(function(){
        if (status === 'active' || !prior.adminProvince)
          return null;

        return getDoc(
          doc(db, 'provinceContacts', prior.adminProvince)
        ).then(function(contact){
          if (contact.exists() && contact.data().uid === uid)
            return deleteDoc(
              doc(db, 'provinceContacts', prior.adminProvince)
            ).then(function(){
              return deletePublicProvinceContact(prior.adminProvince);
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
          if (contact.exists() && contact.data().uid === uid) return deleteDoc(doc(db, 'provinceContacts', province)).then(function(){return deletePublicProvinceContact(province);});
        }) : Promise.resolve();
        return removeContact.then(function(){return deleteDoc(ref);}).then(function(){
          // Nettoyage : un membre supprimé ne reste pas dans la liste des responsables.
          return deleteDoc(doc(db, 'responsables', uid)).catch(function(){});
        });
      });
    },
    /* Publication d'un communiqué (FR/AR + jusqu'à 3 images). */
    addNews:
      function(o){

        var data = {

          cat: o.cat,

          audience: o.audience,

          date: o.date,

          createdAt:
            serverTimestamp()

        };

        if (o.fr)
          data.fr = o.fr;

        if (o.ar)
          data.ar = o.ar;

        var images = Array.isArray(o.images) ? o.images : (o.image ? [o.image] : []);
        images = images.slice(0,3).filter(function(x){ return x; });
        data.hasImage = !!images.length;
        data.imageCount = images.length;

        var ref =
          doc(collection(db, 'news'));

        var jobs = [
          setDoc(ref, data)
        ];

        images.forEach(function(img, idx){
          jobs.push(
            setDoc(
              doc(db, 'newsImages', ref.id + '_' + idx),
              {
                data: String(img).slice(0,400000),
                audience: o.audience || 'public',
                createdAt: serverTimestamp()
              }
            )
          );
        });

        return Promise.all(jobs)
          .then(function(){
            var newsSubject = (o.fr && o.fr.t) ? o.fr.t : ((o.ar && o.ar.t) ? o.ar.t : '');
            var pushTitle = ('Nouveau communiqué' + (newsSubject ? ' : ' + String(newsSubject).trim() : '')).slice(0,120);
            var pushBody = (o.fr && o.fr.b) ? (o.fr.b) : ((o.ar && o.ar.b) ? (o.ar.b) : '');
            console.log('push: triggered news', pushTitle);
            window.cloudSendPush('news', pushTitle, pushBody, null, ref.id).catch(function(){});
            // Diffusion d'une notification à tous les membres.
            return getDocs(collection(db, 'members')).then(function(snap){
              var title = pushTitle;
              var body = pushBody;
              var authorUid = (auth.currentUser && auth.currentUser.uid) ? auth.currentUser.uid : '';
              var tokens = [];
              var writes = snap.docs.map(function(d){
                var m = d.data() || {};
                if (m.status === 'active' && m.uid) {
                  // Collect token for push (async, best-effort).
                }
                return addDoc(collection(db, 'notifications', d.id, 'items'), {
                  title: String(title).slice(0,120),
                  body: String(body).slice(0,500),
                  type: 'news',
                  targetType: 'news',
                  targetId: ref.id,
                  read: false,
                  authorUid: authorUid,
                  createdAt: serverTimestamp()
                }).catch(function(){});
              });
              return Promise.all(writes);
            }).catch(function(){});
          })
          .then(function(){ return ref; });

      },

    deleteNews:
      function(id){

        // Supprime aussi les images rangées à part (docs parfois absents).
        return Promise.all([0,1,2].map(function(idx){
          return deleteDoc(doc(db, 'newsImages', id + '_' + idx)).catch(function(){});
        }))
        .then(function(){
          return deleteDoc(
            doc(db, 'news', id)
          );
        });

      },

    updateNews:
      function(id, o){

        var data = {

          cat: o.cat,

          audience: o.audience,

          date: o.date,

          updatedAt:
            serverTimestamp()

        };

        // Nouvel ensemble d'images : rangé dans newsImages/{id}_{index},
        // et l'ancien champ encodé dans le document (ancienne version) est retiré.
        var images = Array.isArray(o.images) ? o.images : (o.image ? [o.image] : []);
        images = images.slice(0,3).filter(function(x){ return x; });

        if (images.length){
          data.hasImage = true;
          data.imageCount = images.length;
        } else {
          data.hasImage = false;
          data.imageCount = 0;
          data.image = deleteField();
        }

        if (o.fr)
          data.fr = o.fr;

        if (o.ar)
          data.ar = o.ar;

        var jobs = [
          updateDoc(
            doc(db, 'news', id),
            data
          )
        ];

        // Écrit ou écrase chaque index d'image.
        images.forEach(function(img, idx){
          jobs.push(
            setDoc(
              doc(db, 'newsImages', id + '_' + idx),
              {
                data: String(img).slice(0,400000),
                audience: o.audience || 'public',
                createdAt: serverTimestamp()
              }
            )
          );
        });

        // Supprime les indexes inutilisés au-delà du nouveau nombre.
        for (var j = images.length; j < 3; j++){
          jobs.push(deleteDoc(doc(db, 'newsImages', id + '_' + j)).catch(function(){}));
        }

        return Promise.all(jobs);

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

      var ref = doc(collection(db, 'events'));

      var images = Array.isArray(o.images) ? o.images : (o.image ? [o.image] : []);
      images = images.slice(0,3).filter(function(x){ return x; });
      data.hasImage = !!images.length;
      data.imageCount = images.length;

      var jobs = [ setDoc(ref, data) ];
      images.forEach(function(img, idx){
        jobs.push(setDoc(doc(db, 'eventImages', ref.id + '_' + idx), { data: String(img).slice(0,400000), audience: o.audience || 'public', createdAt: serverTimestamp() }));
      });

      return Promise.all(jobs).then(function(){
        return getDocs(collection(db, 'members')).then(function(snap){
          var eventSubject = (o.fr && o.fr.t) ? o.fr.t : ((o.ar && o.ar.t) ? o.ar.t : '');
          var title = ('Nouvel événement' + (eventSubject ? ' : ' + String(eventSubject).trim() : '')).slice(0,120);
          var body = (o.fr && o.fr.b) ? o.fr.b : ((o.ar && o.ar.b) ? o.ar.b : '');
          var authorUid = (auth.currentUser && auth.currentUser.uid) ? auth.currentUser.uid : '';
          var writes = snap.docs.map(function(d){
            return addDoc(collection(db, 'notifications', d.id, 'items'), {
              title: String(title).slice(0,120),
              body: String(body).slice(0,500),
              type: 'event',
              targetType: 'event',
              targetId: ref.id,
              read: false,
              authorUid: authorUid,
              createdAt: serverTimestamp()
            }).catch(function(){});
          });
          // Push via backend (best-effort, non-blocking).
          // Même remarque que pour les actualités : plus de lecture de
          // fcmTokens côté navigateur, le serveur choisit les destinataires.
          window.cloudSendPush('event', title, body, null, ref.id).catch(function(){});
          return Promise.all(writes);
        }).catch(function(){});
      }).then(function(){ return ref; });

    },


  deleteNotificationsForTarget:
    function(targetId){
      if(!auth || !auth.currentUser) return Promise.resolve();
      return getDocs(
        query(collection(db, 'notifications', auth.currentUser.uid, 'items'), where('targetId', '==', targetId))
      ).then(function(snap){
        var writes = snap.docs.map(function(d){ return deleteDoc(d.ref); });
        return Promise.all(writes);
      }).catch(function(){ return Promise.resolve(); });
    },

  deleteEvent:
    function(id){

      return Promise.all([0,1,2].map(function(idx){
        return deleteDoc(doc(db, 'eventImages', id + '_' + idx)).catch(function(){});
      })).then(function(){
        return deleteDoc(doc(db, 'events', id));
      }).then(function(){
        return deleteNotificationsForTarget(id).catch(function(){});
      });

    },


  updateEvent:
    function(id, o){

      var data = {

        date: o.date,

        time: o.time || '',

        updatedAt:
          serverTimestamp()

      };

      if (o.fr)
        data.fr = o.fr;

      if (o.ar)
        data.ar = o.ar;

      return updateDoc(
        doc(db, 'events', id),
        data
      );

    },

    deleteReport:
      function(id){

      // Supprime aussi la pièce jointe rangée à part (doc parfois absent).
      return deleteDoc(
        doc(db, 'reportAttachments', id)
      )
      .catch(function(){})
      .then(function(){
        return deleteDoc(
          doc(db, 'reports', id)
        );
      });

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

    },

  /* Décision sur une demande d'adhésion : seuls le statut, la note et la
     date bougent — jamais le dossier signé (cf. firestore.rules). */
  updateAdhesionStatus: function(uid, status, note){
    if (['pending','needs_completion','accepted','refused'].indexOf(status) < 0){
      return Promise.reject(new Error('Statut invalide'));
    }
    return updateDoc(doc(db, 'adhesionRequests', String(uid)), {
      status: status,
      adminNote: String(note || '').slice(0,1000),
      updatedAt: serverTimestamp()
    });
  },

  /* Suppression définitive d'un dossier d'adhésion (administrateur
     général seulement — cf. firestore.rules). Le PDF officiel rangé à
     part est effacé en premier : sans cela, le dossier supprimé
     laisserait un PDF signé et un état « signée électroniquement »
     orphelins. */
  deleteAdhesion: function(uid){
    var key = String(uid || '');
    return deleteDoc(doc(db, 'adhesionDocuments', key))
      .catch(function(){})
      .then(function(){
        return deleteDoc(doc(db, 'adhesionRequests', key));
      });
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
    CAPACITOR BROWSER PLUGIN
    ========================================================= */

async function loadCapacitorBrowser(){

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
      window.Capacitor.Plugins.Browser
    ){

      capBrowser =
        window.Capacitor.Plugins.Browser;

      return;

    }

    var mod =
      await import(
        'https://cdn.jsdelivr.net/npm/@capacitor/browser@7/dist/esm/index.js'
      );

    capBrowser =
      mod.Browser ||
      (
        mod.default &&
        mod.default.Browser
      ) ||
      mod.default ||
      null;

    if (
      !capBrowser &&
      window.Capacitor.Plugins
    ){

      capBrowser =
        window.Capacitor.Plugins.Browser || null;

    }

  }

  catch(e){

    console.error(
      "Chargement Capacitor Browser:",
      e
    );

    capBrowser = null;

  }

}


/* =========================================================
   INITIALISATION
   ========================================================= */

export async function init(config, h){

  hooks = h;


  await loadNativeAuth();
  await loadCapacitorBrowser();


  firebaseApp =
    initializeApp(config);


  // App Check (facultatif) : si une clé est renseignée dans data.js,
  // chaque requête Firebase porte un jeton App Check (protection anti-robots).
  if (config && config.appCheckKey){

    try{

      initializeAppCheck(
        firebaseApp,
        {
          provider: new ReCaptchaV3Provider(String(config.appCheckKey)),
          isTokenAutoRefreshEnabled: true
        }
      );

    }
    catch(e){
      console.error('App Check:', e);
    }

  }


  auth =
    getAuth(firebaseApp);

  try {
  } catch(e) {}

  try {

    db =
      initializeFirestore(

        firebaseApp,

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
      getFirestore(firebaseApp);

  }


  window.db = db;


/* Envoi push via le backend Vercel.
   Accepte les deux formes d'appel pour rester compatible avec le code déjà
   publié : window.cloudSendPush(type, title, body, targetUid, targetId) et
   window.cloudSendPush({ type, title, body, targetUid, targetId }). */
async function cloudSendPush(a, b, c, d, e){
  var type, title, body, targetUid, targetId;
  if (a && typeof a === 'object') {
    type = a.type; title = a.title; body = a.body;
    targetUid = a.targetUid; targetId = a.targetId;
  } else {
    type = a; title = b; body = c; targetUid = d; targetId = e;
  }

  // Chaque abandon laisse une trace lisible sans console : la dernière
  // tentative est rangée sous ugtm:push:last et affichée dans la fenêtre
  // « Notifications » de l'application.
  function record(status, detail){
    var info = {
      at: new Date().toISOString(),
      type: String(type || ''),
      status: status,
      detail: detail ? String(detail).slice(0, 200) : ''
    };
    try { localStorage.setItem('ugtm:push:last', JSON.stringify(info)); } catch(err){}
    window.UGTM_PUSH_LAST = info;
    return info;
  }

  var configured = (window.APP_DATA && window.APP_DATA.firebase && window.APP_DATA.firebase.pushBackendUrl) || '';
  if (!configured) {
    record('config_missing', 'pushBackendUrl absent de data.js');
    return;
  }
  var url = String(configured).replace(/\/+$/, '');
  try {
    var user = auth && auth.currentUser;
    if (!user && typeof getAuth === 'function') {
      try { user = getAuth(firebaseApp).currentUser; } catch(err){}
    }
    if (!user) {
      record('no_session', 'aucun utilisateur connecté au moment de l\'envoi');
      return;
    }
    var token = await (user.getIdToken ? user.getIdToken() : Promise.reject(new Error('no getIdToken')));
    var payload = { type: type, title: String(title || '').slice(0,120), body: String(body || '').slice(0,500) };
    if (targetUid) payload.targetUid = String(targetUid);
    if (targetId) payload.targetId = String(targetId);
    var res = await fetch(url + '/api/send-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload)
    });
    var raw = '';
    try { raw = await res.text(); } catch(err){}
    var parsed = {};
    try { parsed = JSON.parse(raw); } catch(err){}
    if (!res.ok) {
      // 401/403 = jeton ou droits, 404 = fonction absente du déploiement,
      // 429 = limite d'envoi, 500 = configuration Vercel.
      record(res.status, raw);
      console.warn('push backend ' + res.status + ' ' + url + '/api/send-push', raw.slice(0, 200));
      return;
    }
    record('ok', 'envoyés ' + Number(parsed.sent || 0) + '/' + Number(parsed.total || 0));
  } catch(e){
    record('network_error', (e && e.message) || e);
    console.warn('push backend failed:', e);
  }
}
window.cloudSendPush = cloudSendPush;

/* Renouvellement silencieux du jeton FCM.
   `enablePushNotifications` n'est appelé que sur un clic : quand le jeton
tourne (réinstallation, données de navigation effacées, mise à jour du
navigateur), l'appareil garde un jeton périmé et cesse de recevoir. Ici, si
l'autorisation est DÉJÀ accordée, le jeton est réenregistré au démarrage sans
redemander quoi que ce soit ; aucune demande d'autorisation n'est déclenchée. */
var pushRefreshFor = '';
async function refreshPushTokenQuietly(user){
  try{
    if(!user||!user.uid) return;
    if(typeof Notification==='undefined'||!navigator.serviceWorker) return;
    if(Notification.permission!=='granted') return;
    if(pushRefreshFor===user.uid) return;
    var cfg=(window.APP_DATA&&window.APP_DATA.firebase)||{};
    var vapidKey=cfg.vapidKey||cfg.messagingVapidKey||'';
    if(!vapidKey) return;
    pushRefreshFor=user.uid;
    messaging=messaging||getMessaging(firebaseApp);
    // sw.js est le seul service worker : il porte aussi le SDK FCM.
    await navigator.serviceWorker.register('sw.js');
    var registration=await navigator.serviceWorker.ready;
    var token=await getToken(messaging,{vapidKey:vapidKey,serviceWorkerRegistration:registration});
    if(!token) return;
    await setDoc(doc(db,'fcmTokens',user.uid),{token:token,updatedAt:serverTimestamp()},{merge:true});
  }catch(e){ /* silencieux : jamais bloquant pour l'application */ }
}

/* État des notifications sur CET appareil. Sert au diagnostic affiché
   dans la fenêtre « Notifications » : autorisation, service worker FCM,
   et présence du jeton dans le registre. Lecture seule, aucun envoi. */
async function pushDeviceState(){
  /* L'APK n'a PAS de service worker : les notifications y passent par le
     plugin natif @capacitor/push-notifications. « supported » doit donc
     décrire le canal réellement disponible, sinon l'application annonce à
     tort « navigateur sans service worker » sur Android. */
  var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  var NativePush = isNative && window.Capacitor.Plugins ? window.Capacitor.Plugins.PushNotifications : null;
  var out = {
    native: isNative,
    supported: isNative ? !!NativePush : ((typeof Notification !== 'undefined') && !!navigator.serviceWorker),
    permission: isNative ? 'prompt' : ((typeof Notification !== 'undefined') ? Notification.permission : 'unsupported'),
    registered: false,
    tokenSaved: false,
    error: ''
  };
  try {
    if (isNative && NativePush && typeof NativePush.checkPermissions === 'function') {
      try {
        var nativePerm = await NativePush.checkPermissions();
        if (nativePerm && nativePerm.receive) out.permission = nativePerm.receive;
        out.registered = out.permission === 'granted';
      } catch(e){ /* permission inconnue : on garde « prompt » */ }
    }
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      var regs = await navigator.serviceWorker.getRegistrations();
      out.registered = regs.some(function(r){
        var sw = r.active || r.waiting || r.installing;
        return !!(sw && /\/sw\.js$/.test(String(sw.scriptURL || '')));
      });
    }
    var user = auth && auth.currentUser;
    if (user) {
      var snap = await getDoc(doc(db, 'fcmTokens', user.uid));
      out.tokenSaved = !!(snap.exists() && String((snap.data() || {}).token || '').length > 0);
    }
  } catch(e){ out.error = String((e && e.message) || e).slice(0, 120); }
  return out;
}

/* Dernière tentative d'envoi connue sur cet appareil (voir cloudSendPush). */
function pushLastAttempt(){
  try {
    var raw = localStorage.getItem('ugtm:push:last');
    return raw ? JSON.parse(raw) : null;
  } catch(e){ return null; }
}
async function ensurePushRegistration(){
  if(!auth || !auth.currentUser) return false;
  var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if(!isNative) return false;
  var PushNotifications = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications;
  if(!PushNotifications) return false;
  try {
    var perm = await PushNotifications.checkPermissions();
    if(!perm || perm.receive !== "granted") return false;
    var nativeToken = await new Promise(function(resolve, reject){
      var done = false;
      PushNotifications.addListener("registration", function(t){ if(done) return; done=true; resolve(t && t.value ? t.value : null); });
      PushNotifications.addListener("registrationError", function(e){ if(done) return; done=true; reject(new Error((e && e.error) || "err")); });
      PushNotifications.register().catch(function(e){ if(!done){ done=true; reject(e); } });
      setTimeout(function(){ if(!done){ done=true; resolve(null); } }, 20000);
    });
    if(!nativeToken) return false;
    var snap = await getDoc(doc(db, "fcmTokens", auth.currentUser.uid));
    var data = snap.exists() ? (snap.data() || {}) : {};
    var tokens = Array.isArray(data.tokens) ? data.tokens : [];
    if(tokens.indexOf(nativeToken) < 0){
      await setDoc(doc(db, "fcmTokens", auth.currentUser.uid), { tokens: arrayUnion(nativeToken), token: nativeToken, updatedAt: serverTimestamp() }, { merge: true });
    } else {
      await setDoc(doc(db, "fcmTokens", auth.currentUser.uid), { token: nativeToken, updatedAt: serverTimestamp() }, { merge: true });
    }
    return true;
  } catch(e){ return false; }
}

async function cloudLoadNotifications(){
  if (!auth || !auth.currentUser) return;
  var uid = auth.currentUser.uid;
  try {
    var q = query(collection(db, 'notifications', uid, 'items'), orderBy('createdAt', 'desc'), limit(50));
    var snap = await getDocs(q);
    var list = snap.docs.map(function(d){ var x = d.data() || {}; x.id = d.id; return x; });
    if (typeof window.renderNotifications === 'function') window.renderNotifications(list);
    var unread = list.filter(function(n){ return n && n.read !== true; }).length;
    if (typeof window.updateNotifBadge === 'function') window.updateNotifBadge(unread);
  } catch(e){ console.warn('notif load', e); }
}

async function cloudMarkNotificationRead(id){
  if (!auth || !auth.currentUser) return;
  var uid = auth.currentUser.uid;
  try {
    await updateDoc(doc(db, 'notifications', uid, 'items', id), { read: true });
  } catch(e){ console.warn('notif mark', e); }
}

  window.CLOUD = {

    signIn: signIn,

    signOut: signOut,

    saveProfile: saveProfile,

    deleteAccount: deleteAccount,

    getMyAdhesionRequest: getMyAdhesionRequest,
    submitAdhesion: submitAdhesion,

    // Signature électronique du responsable : valide l'adhésion.
    signAdhesion: signAdhesion,

    // Dossier complet (signatures incluses), chargé à la demande.
    getAdhesionDoc: getAdhesionDoc,

    // PDF officiel : enregistrement et récupération (responsables habilités).
    saveAdhesionPdf: saveAdhesionPdf,
    getSavedAdhesionPdf: getSavedAdhesionPdf,
    adhesionPdfFileName: adhesionPdfFileName,

    addReport: addReport,
    admin: admin,

    enablePushNotifications: async function(){
      if (!auth || !auth.currentUser) throw new Error('Connectez-vous avant d’activer les notifications.');
      var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
      if (isNative) {
        var PushNotifications = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications;
        if (!PushNotifications) throw new Error("Le module de notifications de l'application est absent : installez la dernière version de l'APK.");
        var perm = await PushNotifications.requestPermissions();
        if (!perm || perm.receive !== 'granted') throw new Error('Autorisation de notification non accordée.');
        var nativeToken = await new Promise(function(resolve, reject){
          var done = false;
          PushNotifications.addListener('registration', function(t){ if (done) return; done = true; resolve(t && t.value ? t.value : null); });
          PushNotifications.addListener('registrationError', function(e){ if (done) return; done = true; reject(new Error((e && e.error) || 'Erreur enregistrement push natif.')); });
          PushNotifications.register().catch(function(e){ if(!done){ done=true; reject(e); } });
          setTimeout(function(){ if(!done){ done=true; reject(new Error('Délai dépassé pour le jeton push natif.')); } }, 20000);
        });
        if (!nativeToken) throw new Error('Firebase n’a pas créé de jeton push natif.');
        await setDoc(doc(db, 'fcmTokens', auth.currentUser.uid), { tokens: arrayUnion(nativeToken), token: nativeToken, updatedAt: serverTimestamp() }, { merge: true });
        try { PushNotifications.addListener('pushNotificationActionPerformed', function(action){ var data = (action && action.notification && action.notification.data) || {}; var url = data.targetUrl || data.url; if (url) { try { window.location.href = url; } catch(e){} } }); } catch(e){}
        return true;
      }
      if (typeof Notification === 'undefined' || !navigator.serviceWorker) {
        throw new Error("Ce navigateur ne prend pas en charge les notifications push : ouvrez l'application dans Chrome, et non dans le navigateur intégré d'une autre application.");
      }
      // L'appel à requestPermission est exécuté immédiatement depuis le clic utilisateur.
      var permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Autorisation de notification non accordée.');
      messaging = messaging || getMessaging(firebaseApp);
      await navigator.serviceWorker.register('sw.js');
      var registration = await navigator.serviceWorker.ready;
      var cfg = window.APP_DATA && window.APP_DATA.firebase || {};
      var vapidKey = cfg.vapidKey || cfg.messagingVapidKey || '';
      if (!vapidKey) throw new Error('Clé VAPID absente de la configuration.');
      var token = await getToken(messaging, { vapidKey: vapidKey, serviceWorkerRegistration: registration });
      if (!token) throw new Error('Firebase n’a pas créé de jeton push.');
      await setDoc(doc(db, 'fcmTokens', auth.currentUser.uid), { tokens: arrayUnion(token), token: token, updatedAt: serverTimestamp() }, { merge: true });
      return true;
    },

    loadNotifications: cloudLoadNotifications,
    markNotificationRead: cloudMarkNotificationRead,
    pushDeviceState: pushDeviceState,
    lastPushAttempt: pushLastAttempt,
    ensurePushRegistration: ensurePushRegistration,

    // Chargement à la demande : les listes ne transportent pas les gros champs.
    getNewsImage: function(id){
      return Promise.all([0,1,2].map(function(idx){
        return getDoc(doc(db, 'newsImages', id + '_' + idx))
          .then(function(s){ return s.exists() ? String(s.data().data || '') : null; })
          .catch(function(){ return null; });
      })).then(function(results){
        return results.filter(Boolean);
      });
    },

    getEventImage: function(id){
      return Promise.all([0,1,2].map(function(idx){
        return getDoc(doc(db, 'eventImages', id + '_' + idx))
          .then(function(s){ return s.exists() ? String(s.data().data || '') : null; })
          .catch(function(){ return null; });
      })).then(function(results){
        return results.filter(Boolean);
      });
    },

    getReportAttachment: function(id){
      return Promise.all([0,1,2].map(function(idx){
        return getDoc(doc(db, 'reportAttachments', id + '_' + idx))
          .then(function(s){ return s.exists() ? {data:String(s.data().data||''),name:s.data().name||'',type:s.data().type||''} : null; })
          .catch(function(){ return null; });
      })).then(function(results){
        var arr = results.filter(Boolean);
        if(arr.length) return arr;
        // Rétrocompatibilité : ancienne pièce unique stockée dans reportAttachments/{id}
        return getDoc(doc(db, 'reportAttachments', id))
          .then(function(s){ return s.exists() ? [{data:String(s.data().data||''),name:s.data().name||'',type:s.data().type||''}] : []; })
          .catch(function(){ return []; });
      });
    },

    downloadAdhesionForm: function(){
      var adhUrl = String((window.APP_DATA && window.APP_DATA.links && window.APP_DATA.links.adhesion) || '');

      if (!adhUrl) {
        if (typeof toast === 'function') toast('Lien bientôt disponible', 3500);
        return;
      }

      async function openUrl(url){
        if (capBrowser && capBrowser.open){
          try {
            await capBrowser.open({url: url});
            return;
          } catch(e){
            console.error('Capacitor Browser failed:', e);
          }
        }

        if (/^(https?:|mailto:|tel:)/i.test(url)) {
          window.open(url, '_system', 'noopener');
          return;
        }

        var link = document.createElement('a');
        link.href = url;
        link.download = 'demande-adhesion.pdf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }

      var cleanUrl = adhUrl;

      if (!(/^(https?:|mailto:|tel:)/i.test(adhUrl))) {
        if (cleanUrl.charAt(0) !== '/') {
          var base = window.location.pathname || '/';
          cleanUrl = (base.endsWith('/') ? base : base.replace(/\/[^\/]*$/, '/')) + cleanUrl;
        }
      }

      openUrl(cleanUrl).catch(function(e){
        console.error('Error opening URL:', e);
        if (typeof toast === 'function') toast('Erreur lors de l\'ouverture du fichier', 3500);
      });
    }

  };


  subscribePublicProvinceContacts();

  subscribeEvents();

  subscribeResponsables();


  onAuthStateChanged(
    auth,
    onUser
  );


  hooks.ready();

}
