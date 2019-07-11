'use strict';

const { WebhookClient } = require('dialogflow-fulfillment');
const { Permission } = require('actions-on-google');
const TanWrapper = require('api-tan-wrapper');

module.exports = class Assistant {

  constructor(config) {
    this.tan = new TanWrapper();
    this.agent = new WebhookClient({
      request: config.request,
      response: config.response
    });
    this.nbTimeAsked = 0;
    
    // On utilise l'assistant Google
    this.agent.requestSource = this.agent.ACTIONS_ON_GOOGLE;
  }

  start() {
    // Appelle la fonction liée à l'intention qui a été sélectionnée
    const intentMap = new Map();

    intentMap.set('geolocalisation', this.geolocateUser);
    intentMap.set('position_utilisateur', this.getUserLocation);
    intentMap.set('sauvegarder_arret', this.saveStation);
    intentMap.set('supprimer_arret', this.deleteStation);
    intentMap.set('demander_arret_favori', this.whatIsMyStation);
    intentMap.set('temps_attente_arret', this.getWaitingTime);
    intentMap.set('arrets_a_proximite', this.getCloseStations);
    intentMap.set('horaires_arret', this.getDetailsStations);
    intentMap.set('horaires_arret_suivant', this.getDetailsNextStation);
  
    this.agent.handleRequest(intentMap);
  }

  // Demande l'autorisation de localiser l'utilisateur
  geolocateUser(agent) {
    const conv = agent.conv();
    conv.data.requestedPermission = 'DEVICE_PRECISE_LOCATION';

    // Demande la permission de localiser l'utilisateur
    conv.ask(new Permission({
      context: 'Pour vous localiser',
      permissions: conv.data.requestedPermission,
    }));

    agent.add(conv);
  }

  // Localise l'utilisateur
  getUserLocation(agent) {
    const conv = agent.conv();
    const requestedPermission = conv.data;

    if (requestedPermission !== 'DEVICE_PRECISE_LOCATION') {
      return agent.add("J'ai besoin de votre autorisation pour vous localiser.");
    }

    // La localisation est retournée sous forme de latitude / longitude
    const coordinates = conv.device.location;
    if (!coordinates) {
      return agent.add('Désolé, je ne parviens pas à vous localiser.');
    }

    conv.user.storage.location = {
      latitude: coordinates.latitude,
      longitude: coordinates.longitude
    }

    agent.add(conv);
    return agent.add(`Vous êtes à ${coordinates.latitude}, ${coordinates.longitude}.`);
  }

  // Sauvegarde l'arrêt favori de l'utilisateur
  // Conservé indéfiniment, peut être utilisé dans chaque conversations
  saveStation(agent) {
    const conv = agent.conv();

    // On vérifie que l'utilisateur est identifié pour enregistrer son arrêt préféré
    if (conv.user.verification !== 'VERIFIED') {
      return agent.add("Désolé, je ne peux pas sauvegarder votre arrêt préféré.");
    }
    // On vérifie que l'utilisateur à bien indiqué un arrêt
    if (!agent.parameters.arret) {
      return agent.add("Désolé, je n'ai pas saisi le nom de l'arrêt.");
    }

    conv.user.storage.arret = agent.parameters.arret;

    conv.ask(`L'arrêt ${agent.parameters.arret} a bien été sauvegardé.`);
    agent.add(conv);
  }

  // Renseigne l'utilisateur sur son arrêt favori
  whatIsMyStation(agent) {
    const conv = agent.conv();

    if (conv.user.storage.arret) {
      return agent.add("Vous n'avez pas d'arrêt préféré.");
    }
      
    conv.ask(`Votre arrêt préféré est ${conv.user.storage.arret}`);
    agent.add(conv);
  }

  // Supprime l'arrêt favori de l'utilisateur
  deleteStation(agent) {
    const conv = agent.conv();

    // On vérifie si l'utilisateur a déjà indiqué un arrêt
    if (!conv.user.storage.arret) {
      return agent.add("Vous n'avez pas d'arrêt préféré.");
    }

    conv.user.storage.arret = {};

    conv.ask("Votre arrêt préféré a été supprimé.");
    agent.add(conv);
  }

  // Indique le prochain départ de tram pour les 2 directions à un arrêt particulier
  async getWaitingTime (agent) {
    tan = new TanWrapper();
    let arret = '';

    // Prend l'arrêt préféré si pas d'arrêt indiqué
    if (agent.conv().user.storage.arret.length) arret = agent.conv().user.storage.arret;
    if (agent.parameters.arret) arret = agent.parameters.arret;

    // On a besoin d'un arrêt pour continuer.
    if (!arret) return agent.add("Je n'ai pas compris le nom de l'arrêt.");

    const tramStations = await tan.getAllTramStations();
    const nameStation = await tan.getSimilarStationsName(arret, tan.parseStationsToList(tramStations), 1);
    const details = await tan.getWaitingTimeFromStation(nameStation[0].name, 'name');

    // Sélectionne seulement les tramways
    const onlyTram = details.filter(station => station.ligne.typeLigne == 1);

    // Pour la première version, on ne propose que les horaires pour les tramways
    if (!onlyTram) return agent.add("Je n'ai aucun horaires à vous proposer.");

    let sens1 = 0;
    let sens2 = 0;
    let nextTimes = [];

    // Récupère le prochain horaire pour chaque sens
    for (let i = 0; i < onlyTram.length && (sens1 == 0 || sens2 == 0); i++) {
      if (onlyTram[i].sens == 1 && sens1 == 0) {
        if (onlyTram[i].temps === "Proche") onlyTram[i].temps = "moins de 2 minutes";
        nextTimes.push(onlyTram[i]);
        sens1++;
      }
      if (onlyTram[i].sens == 2 && sens2 == 0) {
        if (onlyTram[i].temps === "Proche") onlyTram[i].temps = "moins de 2 minutes";
        nextTimes.push(onlyTram[i]);
        sens2++;
      }
    }

    let response = `Voici les prochains passages pour l'arrêt ${nameStation[0].name}.`;
    response += `Le prochain tram de la ligne ${nextTimes[0].ligne.numLigne} passe dans ${nextTimes[0].temps} en direction de ${nextTimes[0].terminus}.`;
    
    if (nextTimes.length > 1)
      response += ` Le prochain tram de la ligne ${nextTimes[1].ligne.numLigne} passe dans ${nextTimes[1].temps} en direction de ${nextTimes[1].terminus}`;

    return agent.add(response);
  }

  // Recherche les arrêts de trams à proximité (dans un rayon de 500m)
  async getCloseStations (agent) {
    // Latitude & longitude de l'IMIE. C'est temporaire
    const LATITUDE = '47,261';
    const LONGITUDE = '-1,583';
    tan = new TanWrapper();

    const stations = await tan.getStationsWithLocation(LATITUDE, LONGITUDE);

    if (!stations) {
      return agent.add("Désolé, je ne parviens pas à trouver d'arrêts.");
    }

    let nbStops = 0;
    let resultAgent = '';

    for (var i = 0; i < stations.length; i++) {
      const isTram = stations[i].ligne.filter(ligne => parseInt(ligne.numLigne) <= 3);
      if (isTram.length > 0) { // Si c'est une station où passent les tramways
        if (i != 0) resultAgent += ", ";
        resultAgent += stations[i].libelle + " à " + stations[i].distance;
        nbStops++;
      }
    }

    if (nbStops > 1) resultAgent = "Les arrêts les plus proches sont " + resultAgent;
    else resultAgent = "L'arrêt le plus proche est " + resultAgent;
    
    agent.add(resultAgent);
  }

  // Recherche les horaires pour un arrêt, une ligne et une direction en particulier
  async getDetailsStations (agent) {
    tan = new TanWrapper();
    let arret = "";

    if (agent.conv().user.storage.arret && agent.conv().user.storage.arret.length) arret = agent.conv().user.storage.arret;
    if (agent.parameters.arret) arret = agent.parameters.arret;

    if (!arret) {
      return agent.add("Je n'ai pas compris le nom de l'arrêt.");
    }

    const tramStations = await tan.getAllTramStations();
    const nameStation = await tan.getSimilarStationsName(arret, tan.parseStationsToList(tramStations), 1);
    const arrayStations = { // Entité "direction"
      "Beaujoire": 2, // Terminus est ligne 1
      "Ranzay": 2, // Terminus est ligne 1
      "François Mitterand": 1, // Terminus ouest ligne 1
      "Jamet": 1, // Terminus ouest ligne 1
      "Orvault Grand-Val": 1, // Terminus nord ligne 2
      "Gare de Pont Rousseau": 2, // Terminus sud ligne 2
      "Marcel Paul": 1, // Terminus nord ligne 3
      "Neustrie": 2 // Terminus sud ligne 3
    };

    let direction = 0;
    let ligne = 0;

    if (!agent.parameters.direction) return agent.add("Je n'ai pas compris la direction demandée.");
    direction = arrayStations[agent.parameters.direction];

    if (!agent.parameters.ligne) return agent.add("Je n'ai pas compris la ligne demandée.");
    ligne = agent.parameters.ligne;

    // TODO: vérifier que l'arrêt et la direction sont pour la bonne ligne
    //checkValidDirections(direction, ligne);
    //checkValidStops(ligne, nameStation[0].name);

    const times = await tan.getTimesFromStation(nameStation[0].name, 'name', ligne, direction);
    
    if (!times.prochainsHoraires || !times.prochainsHoraires[0].passages) {
      return agent.add("Désolé, je n'ai pas d'horaires à vous proposer.");
    }
  
    agent.add("Voici le prochain horaire de passage: " + times.prochainsHoraires[0].heure + times.prochainsHoraires[0].passages[0]);

    // On crée un contexte qui dure 5 tours pour garder en mémoire les prochains horaires
    agent.context.set({
      'name': 'horaires_arret_suivant',
      'lifespan': 5,
      'parameters': {
        'arret': nameStation[0].name,
        'ligne': ligne,
        'direction': direction,
        'prochainsHoraires': times.prochainsHoraires
      }
    });
  }

  // Donne les horaires suivant
  async getDetailsNextStation (agent) {
    tan = new TanWrapper();
    let nbTimesAsked = nbTimesAsked++ || 0;
    var inputContext = agent.context.get('horaires_arret_suivant');

    if (!inputContext) return agent.add("Désolé, je n'ai pas compris.");
    const times = inputContext.parameters.prochainsHoraires;

    if (times[nbTimesAsked] && times[nbTimesAsked].passages[nbTimesAsked])
        agent.add("Voici le prochain horaire de passage: " + times[nbTimesAsked].heure + times[nbTimesAsked].passages[nbTimesAsked]);
    else {
      nbTimesAsked = 0;
      agent.add("Je n'ai plus d'horaires à vous proposer.");
    }
  }
}