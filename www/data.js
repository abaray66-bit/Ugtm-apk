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
    appId: "1:313270677240:web:e93739d6533750b3dd150d"
  },

  // Administrateurs (adresses e-mail)
  adminEmails: ["abaray66@gmail.com"],

  // Liens utiles
  links: {
    site: "https://www.ugtm.ma",
    form: "#report"
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
  },

  // Section Contact - affichée dans l'onglet Contact
  contact: [
    {
      title: "Chaîne WhatsApp",
      description: "Communiqués de la Fédération régionale de la Santé. Les numéros des abonnés restent privés.",
      icon: "💬",
      url: "https://wa.me/212661386247",
      action: "openUrl"
    },
    {
      title: "Numéro dédié WhatsApp",
      description: "Échanges directs et envoi de pièces, sur WhatsApp.",
      icon: "📱",
      url: "https://wa.me/212661386247",
      action: "openUrl"
    },
    {
      title: "Canal Telegram",
      description: "Les mêmes communiqués, en double.",
      icon: "✈️",
      url: "https://t.me/ugtmsoussmasaa",
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
