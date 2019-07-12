# PoC Google Home

### Pour faire fonctionner le PoC

1. Installer les dépendances
`yarn // ou yarn install`

2. Lancer l'application
`yarn start // ou yarn dev`

3. Si en local, il faut lancer ngrok a côté et ne pas oublier de mettre à jour l'url https dans l'onglet "Fulfillment" de la console Dialogflow
`yarn online`

4. Pour mettre à jour les actions sur console actions
`gactions update -project [projectID] --action_package actions.json`

---

Lien vers Google Actions : https://console.actions.google.com

Lien vers DialogFlow : https://console.dialogflow.com