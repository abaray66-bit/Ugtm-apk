// Configuration UGTM Souss-Massa
// À modifier selon vos besoins

window.APP_DATA = {
  // Titres et informations générales
  appTitle: "UGTM Souss-Massa",
  appSubtitle: "Fédération régionale de la Santé",
  appDescription: "Plateforme de communication pour les adhérents et militants",

  // Firebase - Activé pour les comptes et administration
  firebase: {
    apiKey: "AIzaSyB-xhY-y5uuglA4ZUuXfM8FY5C6eTTZRMg",
    authDomain: "ugtm-fns-souss-massa.web.app",
    projectId: "ugtm-fns-souss-massa",
    appId: "1:313270677240:web:e93739d6533750b3dd150d",
    // Clé App Check (reCAPTCHA v3) — FACULTATIVE.
    // Laisser vide : rien ne change. Renseignée (Firebase > Paramètres >
    // Application > App Check), l'app joint un jeton App Check à chaque
    // requête Firebase, ce qui bloque les robots. Voir SETUP-FIREBASE.txt.
    appCheckKey: ""
  },

  // Administrateurs (adresses e-mail)
  adminEmails: ["abaray66@gmail.com"],

  // Liens utiles
  links: {
    site: "https://www.ugtm.ma",
    form: "#report",
    // Lien de téléchargement de la demande d'adhésion (Google Drive, Dropbox, site…)
    // Laissez vide : le bouton affiche « Lien bientôt disponible ».
    adhesion: "https://ugtm-fns-souss-massa.web.app/demande-adhesion.pdf"
  },

  // Communiqués (gérés via l'espace admin après configuration)
  news: [],

  // Événements (gérés via l'espace admin après configuration)
  events: [],

  // Permanence
  permanence: {
    title: "Permanence de la Fédération régionale de la Santé",
    address: "Agadir, Souss-Massa",
    phone: "06 61 38 62 47",
    email: "abaray66@gmail.com",
    hours: "Lundi - Vendredi, 09:00 - 17:00"
    // Les responsables syndicaux ne se saisissent pas ici :
    // l'admin les désigne depuis l'espace administrateur (onglet Membres) et
    // ils apparaissent aussitôt sous « Permanence syndicale » (onglet Contact).
  },

  // Section Contact - affichée dans l'onglet Contact
  contact: [
    {
      title: "Groupe de communication régional",
      description: "Rejoignez le groupe WhatsApp de communication de la Fédération régionale de la Santé.",
      icon: "💬",
      url: "https://chat.whatsapp.com/HohMZIZCxylJFk3ugYUsfM?s=cl&p=a&ilr=4&iam=0",
      action: "openUrl"
    },
    {
      title: "Numéro du secrétaire régional sur WhatsApp",
      description: "Échanges directs et envoi de pièces, sur WhatsApp.",
      icon: "📱",
      url: "https://wa.me/212661386247",
      action: "openUrl"
    },
    {
      title: "Page officielle Facebook",
      description: "Suivez la Fédération régionale de la Santé sur sa page officielle Facebook.",
      icon: "f",
      url: "https://www.facebook.com/share/1DKBvHZqsN/",
      action: "openUrl"
    },
    {
      title: "Appeler",
      description: "Permanence de la Fédération régionale de la Santé",
      icon: "☎️",
      url: "tel:+212661386247",
      action: "openUrl"
    }
  ],

  // Provinces de Souss-Massa (libellés identiques à firestore.rules et aux signalements)
  provinces: [
    "Agadir Ida-Outanane",
    "Chtouka-Aït Baha",
    "Inezgane-Aït Melloul",
    "Tata",
    "Taroudant",
    "Tiznit"
  ]
};
