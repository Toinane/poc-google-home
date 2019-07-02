const express = require('express')
const bodyParser = require('body-parser')
const {actionssdk, Image} = require('actions-on-google');

const app = actionssdk({debug: true});

app.intent('actions.intent.MAIN', (conv) => {
  conv.ask('Salut!');
  conv.ask(new Image({
    url: 'https://i2.wp.com/devotics.fr/wp-content/uploads/2017/08/cropped-logo-tranparent-400x434-1.png?fit=400%2C438&ssl=1',
    alt: 'Devotics'
  }))
});

app.intent('actions.intent.TEXT', handleTextIntent);

function handleTextIntent(conv, input) {
  if (input === 'tu fonctionnes ?') {
    conv.ask('Oué grave, je marche bien, hé !');
  } else {
    conv.ask('Aïe, je suis désolé mais non, je n\'ai rien compris là.');
  }
}

express().use(bodyParser.json(), app).listen(3000);