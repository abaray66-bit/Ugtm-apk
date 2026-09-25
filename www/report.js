/* =========================================================
   UGTM SOUSS-MASSA — FORMULAIRE DE SIGNALEMENT
   Fichier : www/report.js
   ========================================================= */

(function () {
  "use strict";

  var container = document.getElementById("report-container");

  if (!container) {
    console.warn("UGTM : #report-container introuvable.");
    return;
  }

  /* =========================
     STYLE
     ========================= */

  var style = document.createElement("style");

  style.textContent = `
    .ugtm-report-box {
      width: 100%;
      max-width: 720px;
      margin: 20px auto;
      padding: 22px;
      background: #fff;
      border-radius: 18px;
      box-shadow: 0 5px 25px rgba(0,0,0,.08);
      box-sizing: border-box;
    }

    .ugtm-report-title {
      margin: 0 0 6px;
      font-size: 23px;
      font-weight: 800;
      color: #17365d;
    }

    .ugtm-report-subtitle {
      margin: 0 0 20px;
      color: #666;
      font-size: 14px;
      line-height: 1.5;
    }

    .ugtm-report-field {
      margin-bottom: 15px;
    }

    .ugtm-report-field label {
      display: block;
      margin-bottom: 6px;
      font-weight: 700;
      font-size: 14px;
      color: #333;
    }

    .ugtm-report-field input,
    .ugtm-report-field select,
    .ugtm-report-field textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 12px 13px;
      border: 1px solid #d8d8d8;
      border-radius: 10px;
      background: #fafafa;
      font-family: inherit;
      font-size: 15px;
      outline: none;
    }

    .ugtm-report-field input:focus,
    .ugtm-report-field select:focus,
    .ugtm-report-field textarea:focus {
      border-color: #17365d;
      background: #fff;
    }

    .ugtm-report-field textarea {
      min-height: 140px;
      resize: vertical;
    }

    .ugtm-report-anonymous {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 13px;
      margin: 5px 0 18px;
      background: #f5f7fa;
      border-radius: 10px;
    }

    .ugtm-report-anonymous input {
      width: 18px;
      height: 18px;
    }

    .ugtm-report-anonymous label {
      margin: 0;
      font-weight: 700;
      cursor: pointer;
    }

    .ugtm-report-help {
      margin-top: 5px;
      font-size: 12px;
      color: #777;
      line-height: 1.4;
    }

    .ugtm-report-submit {
      width: 100%;
      border: 0;
      border-radius: 11px;
      padding: 14px;
      background: #17365d;
      color: white;
      font-size: 16px;
      font-weight: 800;
      cursor: pointer;
    }

    .ugtm-report-submit:disabled {
      opacity: .6;
      cursor: not-allowed;
    }

    .ugtm-report-message {
      display: none;
      margin-top: 15px;
      padding: 13px;
      border-radius: 10px;
      font-size: 14px;
      line-height: 1.5;
    }

    .ugtm-report-message.success {
      display: block;
      background: #eaf7ef;
      color: #176b38;
    }

    .ugtm-report-message.error {
      display: block;
      background: #fff0f0;
      color: #a32121;
    }

    .ugtm-report-file {
      background: white !important;
    }
  `;

  document.head.appendChild(style);

  /* =========================
     INTERFACE
     ========================= */

  container.innerHTML = `
    <div class="ugtm-report-box">

      <h2 class="ugtm-report-title">
        Signaler un dysfonctionnement
      </h2>

      <p class="ugtm-report-subtitle">
        Utilisez ce formulaire pour transmettre un problème ou une situation
        nécessitant l'intervention de la Fédération régionale UGTM Souss-Massa.
      </p>

      <form id="ugtm-report-form">

        <div class="ugtm-report-anonymous">
          <input type="checkbox" id="report-anonymous">
          <label for="report-anonymous">
            Je souhaite rester anonyme
          </label>
        </div>

        <div class="ugtm-report-field" id="report-name-box">
          <label for="report-name">
            Nom et prénom
          </label>

          <input
            type="text"
            id="report-name"
            maxlength="120"
            autocomplete="name"
            placeholder="Votre nom et prénom"
          >
        </div>

        <div class="ugtm-report-field">
          <label for="report-etab">
            Établissement
          </label>

          <input
            type="text"
            id="report-etab"
            maxlength="160"
            placeholder="Nom de l'établissement"
            required
          >
        </div>

        <div class="ugtm-report-field">
          <label for="report-category">
            Catégorie
          </label>

          <select id="report-category" required>
            <option value="">Sélectionner une catégorie</option>
            <option value="Conditions de travail">
              Conditions de travail
            </option>
            <option value="Ressources humaines">
              Ressources humaines
            </option>
            <option value="Mutation / Affectation">
              Mutation / Affectation
            </option>
            <option value="Droits professionnels">
              Droits professionnels
            </option>
            <option value="Harcèlement / Pression">
              Harcèlement / Pression
            </option>
            <option value="Sécurité">
              Sécurité
            </option>
            <option value="Autre">
              Autre
            </option>
          </select>
        </div>

        <div class="ugtm-report-field">
          <label for="report-date">
            Date des faits
          </label>

          <input
            type="date"
            id="report-date"
          >
        </div>

        <div class="ugtm-report-field">
          <label for="report-location">
            Lieu des faits
          </label>

          <input
            type="text"
            id="report-location"
            maxlength="160"
            placeholder="Service, établissement ou lieu"
          >
        </div>

        <div class="ugtm-report-field">
          <label for="report-description">
            Description des faits
          </label>

          <textarea
            id="report-description"
            maxlength="4000"
            placeholder="Décrivez les faits de manière précise et factuelle..."
            required
          ></textarea>

          <div class="ugtm-report-help">
            Maximum 4000 caractères. Évitez les informations inutiles
            concernant des personnes qui ne sont pas directement concernées.
          </div>
        </div>

        <div class="ugtm-report-field">
          <label for="report-file">
            Pièce jointe
          </label>

          <input
            class="ugtm-report-file"
            type="file"
            id="report-file"
            accept="image/*,.pdf,.doc,.docx"
          >

          <div class="ugtm-report-help">
            Vous pouvez joindre une photo ou un document.
          </div>
        </div>

        <button
          type="submit"
          class="ugtm-report-submit"
          id="report-submit"
        >
          Envoyer le signalement
        </button>

        <div
          id="report-message"
          class="ugtm-report-message"
        ></div>

      </form>
    </div>
  `;

  /* =========================
     ELEMENTS
     ========================= */

  var form = document.getElementById("ugtm-report-form");
  var anonymous = document.getElementById("report-anonymous");
  var nameBox = document.getElementById("report-name-box");
  var nameInput = document.getElementById("report-name");
  var etabInput = document.getElementById("report-etab");
  var categoryInput = document.getElementById("report-category");
  var dateInput = document.getElementById("report-date");
  var locationInput = document.getElementById("report-location");
  var descriptionInput = document.getElementById("report-description");
  var fileInput = document.getElementById("report-file");
  var submitButton = document.getElementById("report-submit");
  var message = document.getElementById("report-message");

  /* =========================
     ANONYME
     ========================= */

  anonymous.addEventListener("change", function () {
    if (anonymous.checked) {
      nameBox.style.display = "none";
      nameInput.value = "";
    } else {
      nameBox.style.display = "block";
    }
  });

  /* =========================
     MESSAGE
     ========================= */

  function showMessage(text, type) {
    message.textContent = text;
    message.className = "ugtm-report-message " + type;
  }

  /* =========================
     FICHIER → DATA URL
     ========================= */

  function readFile(file) {
    return new Promise(function (resolve, reject) {

      if (!file) {
        resolve({
          name: "",
          type: "",
          data: ""
        });
        return;
      }

      /*
       * Limite volontaire pour rester compatible
       * avec les règles Firestore actuelles.
       */
      if (file.size > 300000) {
        reject(
          new Error(
            "La pièce jointe est trop volumineuse. " +
            "Veuillez choisir un fichier inférieur à 300 Ko."
          )
        );
        return;
      }

      var reader = new FileReader();

      reader.onload = function () {
        resolve({
          name: file.name.substring(0, 120),
          type: file.type.substring(0, 80),
          data: reader.result || ""
        });
      };

      reader.onerror = function () {
        reject(
          new Error("Impossible de lire la pièce jointe.")
        );
      };

      reader.readAsDataURL(file);
    });
  }

  /* =========================
     ENVOI
     ========================= */

  form.addEventListener("submit", async function (event) {

    event.preventDefault();

    message.className = "ugtm-report-message";
    message.textContent = "";

    submitButton.disabled = true;
    submitButton.textContent = "Envoi en cours...";

    try {

      /*
       * On attend que cloud.js ait terminé son initialisation.
       */
      if (
        !window.UGTM ||
        typeof window.UGTM.addReport !== "function"
      ) {
        throw new Error(
          "Le service de signalement n'est pas encore disponible."
        );
      }

      /*
       * Vérification utilisateur.
       */
      var user = window.UGTM.user || null;

      /*
       * Si l'application ne permet pas l'accès anonyme
       * Firebase, le formulaire demandera une connexion.
       */
      if (!anonymous.checked && !user) {
        throw new Error(
          "Veuillez vous connecter avant d'envoyer un signalement identifié."
        );
      }

      var file = fileInput.files && fileInput.files[0]
        ? fileInput.files[0]
        : null;

      var attachment = await readFile(file);

      var payload = {
        anonymous: anonymous.checked,

        name: anonymous.checked
          ? ""
          : nameInput.value.trim(),

        etab: etabInput.value.trim(),

        category: categoryInput.value,

        description: descriptionInput.value.trim(),

        date: dateInput.value || "",

        location: locationInput.value.trim(),

        attachmentName: attachment.name,

        attachmentType: attachment.type,

        attachmentData: attachment.data
      };

      /*
       * Vérifications minimales.
       */

      if (!payload.etab) {
        throw new Error(
          "Veuillez indiquer votre établissement."
        );
      }

      if (!payload.category) {
        throw new Error(
          "Veuillez sélectionner une catégorie."
        );
      }

      if (!payload.description) {
        throw new Error(
          "Veuillez décrire les faits."
        );
      }

      if (!payload.anonymous && !payload.name) {
        throw new Error(
          "Veuillez indiquer votre nom et prénom."
        );
      }

      /*
       * Envoi vers cloud.js.
       */
      await window.UGTM.addReport(payload);

      showMessage(
        "Votre signalement a été transmis avec succès à la Fédération régionale.",
        "success"
      );

      form.reset();

      nameBox.style.display = "block";

    } catch (error) {

      console.error(
        "UGTM — erreur signalement :",
        error
      );

      showMessage(
        error && error.message
          ? error.message
          : "Une erreur est survenue lors de l'envoi.",
        "error"
      );

    } finally {

      submitButton.disabled = false;
      submitButton.textContent =
        "Envoyer le signalement";
    }
  });

})();
