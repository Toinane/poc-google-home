'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const { WebhookClient } = require('dialogflow-fulfillment');
const { Permission } = require('actions-on-google');
const tanWrapper = require('api-tan-wrapper');

const expressApp = express().use(bodyParser.json())
const tan = new tanWrapper();

expressApp.get('/', function (req, res) { });

expressApp.post('/', async function (req, res) {
  const agent = new WebhookClient({ request: req, response: res });
  agent.requestSource = agent.ACTIONS_ON_GOOGLE; // On utilise l'assistant Google
  const tramStations = await tan.getAllTramStations();

  function saveStop(agent) {
    let conv = agent.conv();

    // On vérifie que l'utilisateur est identifié pour enregistrer son arrêt préféré
    if (conv.user.verification === 'VERIFIED') {
      if (agent.parameters.arret) {
        conv.user.storage.arret = {
          arret: agent.parameters.arret
        };
        conv.ask(`L'arrêt ${agent.parameters.arret} a bien été sauvegardé.`);
        agent.add(conv);
      }
      else
        agent.add("Désolé, je n'ai pas saisi le nom de l'arrêt.");
    }
    else
      agent.add("Désolé, je ne peux pas sauvegarder votre arrêt préféré.");
  }

  function deleteStop(agent) {
    let conv = agent.conv();

    if (conv.user.storage.arret) {
      conv.user.storage.arret = {};
      conv.ask("Votre arrêt préféré a été supprimé.");
      agent.add(conv);
    }
    else
      agent.add("Vous n'avez pas d'arrêt préféré.");
  }

  function geolocate(agent) {
    let conv = agent.conv();

    conv.data.requestedPermission = 'DEVICE_PRECISE_LOCATION';

    conv.ask(new Permission({ // Demande la permission de localiser l'utilisateur
      context: 'Pour vous localiser',
      permissions: conv.data.requestedPermission,
    }));
    agent.add(conv);
  }

  function getLocationUser(agent) {
    let conv = agent.conv();
    var requestedPermission = conv.data;

    if (requestedPermission === 'DEVICE_PRECISE_LOCATION') {
      // La localisation est retournée sous forme de latitude / longitude
      var coordinates = conv.device.location;
      if (coordinates) {
        conv.user.storage.location = {
          latitude: coordinates.latitude,
          longitude: coordinates.longitude
        }
        agent.add(conv);
        return agent.add(`Vous êtes à ${coordinates.latitude}, ${coordinates.longitude}.`);
      }
      else
        return agent.add('Désolé, je ne parviens pas à vous localiser.');
    }
    else
      return agent.add("J'ai besoin de votre autorisation pour vous localiser.");
  }

  async function getWaitTime(agent) {
    var arret = "";

    if (agent.conv().user.storage.arret) // Prend l'arrêt préféré si pas d'arrêt indiqué
      arret = agent.conv().user.storage.arret;
    if (agent.parameters.arret)
      arret = agent.parameters.arret;

    if (arret) {
      var nameStation = await tan.getSimilarStationsName(arret, tan.parseStationsToList(tramStations), 1);
      var details = await tan.getWaitingTimeFromStation(nameStation[0].name, 'name');

      var onlyTram = details.filter(station => {
        return station.ligne.typeLigne == 1; // Sélectionne seulement les tramways
      });

      if (onlyTram) {
        let sens1 = 0;
        let sens2 = 0;
        let nextTimes = [];

        // Récupère le prochain horaire pour chaque sens
        for (let i = 0; i < onlyTram.length && (sens1 == 0 || sens2 == 0); i++) {
          if (onlyTram[i].sens == 1 && sens1 == 0)
          {
            if (onlyTram[i].temps === "Proche")
              onlyTram[i].temps = "moins de 2 minutes";
            nextTimes.push(onlyTram[i]);
            sens1++;
          }
          if (onlyTram[i].sens == 2 && sens2 == 0) {
            if (onlyTram[i].temps === "Proche")
              onlyTram[i].temps = "moins de 2 minutes";
            nextTimes.push(onlyTram[i]);
            sens2++;
          }
        }

        var response = "Le prochain tram de la ligne " + nextTimes[0].ligne.numLigne + " passe dans " + nextTimes[0].temps + " en direction de " + nextTimes[0].terminus + ". ";
        if (nextTimes.length > 1)
          response += "Le prochain tram de la ligne " + nextTimes[1].ligne.numLigne + " passe dans " + nextTimes[1].temps + " en direction de " + nextTimes[1].terminus;

        return agent.add(response);
      }
      else
        return agent.add("Je n'ai aucun horaires à vous proposer.");
    }
    else
      return agent.add("Je n'ai pas compris le nom de l'arrêt.");
  }

  async function getCloseStops(agent) {
    var lat = '47,261'; // NANTES IMIE
    var long = '-1,583'; // TEMPORAIRE
    var nbStops = 0;
    var resultAgent = "";

    var stations = await tan.getStationsWithLocation(lat, long);

    if (stations) {
      for (var i = 0; i < stations.length; i++) {
        var isTram = stations[i].ligne.filter(ligne => parseInt(ligne.numLigne) <= 3);
        if (isTram.length > 0) { // Si c'est une station où passent les tramways
          if (i != 0)
            resultAgent += ", ";
          resultAgent += stations[i].libelle + " à " + stations[i].distance;
          nbStops++;
        }
      }
      if (nbStops > 1)
        resultAgent = "Les arrêts les plus proches sont " + resultAgent;
      else
        resultAgent = "L'arrêt le plus proche est " + resultAgent;
      agent.add(resultAgent);
    }
    else
      agent.add("Désolé, je ne parviens pas à trouver d'arrêts.");
  }

  async function getDetailsStop(agent) {
    var arret = "";

    if (agent.conv().user.storage.arret)
      arret = agent.conv().user.storage.arret;
    if (agent.parameters.arret)
      arret = agent.parameters.arret;

    if (arret) {
    var nameStation = await tan.getSimilarStationsName(arret, tan.parseStationsToList(tramStations), 1);
      var arrayStations = { // Entité "direction"
        "Beaujoire": 2, // Terminus est ligne 1
        "Ranzay": 2, // Terminus est ligne 1
        "François Mitterand": 1, // Terminus ouest ligne 1
        "Jamet": 1, // Terminus ouest ligne 1
        "Orvault Grand-Val": 1, // Terminus nord ligne 2
        "Gare de Pont Rousseau": 2, // Terminus sud ligne 2
        "Marcel Paul": 1, // Terminus nord ligne 3
        "Neustrie": 2 // Terminus sud ligne 3
      };
      var direction = 0;
      var ligne = 0;

      if (agent.parameters.direction)
        direction = arrayStations[agent.parameters.direction];
      else
        return agent.add("Je n'ai pas compris la direction demandée.");

      if (agent.parameters.ligne)
        ligne = agent.parameters.ligne;
      else
        return agent.add("Je n'ai pas compris la ligne demandée.");

      // TODO vérifier que l'arrêt et la direction sont pour la bonne ligne
      //checkValidDirections(direction, ligne);
      //checkValidStops(ligne, nameStation[0].name);

      var times = await tan.getTimesFromStation(nameStation[0].name, 'name', ligne, direction);

      //console.log(times);
      //console.log(times.prochainsHoraires[0]);

      // TODO a améliorer
      agent.add("Voici les prochains horaires de passage: " + times.prochainsHoraires[0].heure + times.prochainsHoraires[0].passages[0]);
      //console.log(agent.contexts);

      console.log(agent);
      console.log(agent.getContext());

      //console.log(agent.context);

      // agent.contexts.push({
      //   'name': 'lol_test',
      //   'lifespan': 5,
      //   'parameters': {
      //     'arret': nameStation[0].name,
      //     'ligne': ligne,
      //     'direction': direction,
      //     'prochainsHoraires': times.prochainsHoraires
      //   }
      // });

      agent.context.set({
        'name': 'test',
        'lifespan': 5,
        'parameters': {
          'ligne': ligne
        }
      });

      //console.log(agent.contexts);

    }
    else
      return agent.add("Je n'ai pas compris le nom de l'arrêt.");
  }

  async function getDetailsStopNext(agent) {
    console.log(agent);
    console.log(agent.getContext());
    //console.log(agent.contexts);


    //var inputContext = agent.contexts
    //var inputContext = agent.contexts[0];

    //console.log(inputContext);
  }

  // Appelle la fonction liée à l'intention qui a été sélectionnée
  let intentMap = new Map();
  intentMap.set('geolocalisation', geolocate);
  intentMap.set('position_utilisateur', getLocationUser);
  intentMap.set('sauvegarder_arret', saveStop);
  intentMap.set('supprimer_arret', deleteStop);
  intentMap.set('temps_attente_arret', getWaitTime);
  intentMap.set('arrets_a_proximite', getCloseStops);
  intentMap.set('horaires_arret', getDetailsStop);
  intentMap.set('horaires_arret_suivant', getDetailsStopNext);
  agent.handleRequest(intentMap);
});

expressApp.listen(3000)