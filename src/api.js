'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const Assistant = require('./assistant.service');

const port = process.env.PORT || 3000;
const app = express();

app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.json({ api: 'ok' });
});

app.post('/', async (req, res) => {
  try {
    const assistant = new Assistant({ request: req, response: res });

    assistant.start();
  }
  catch(error) {
    console.log(error);
    res.status(500).json({ error: 'Oops, something went wrong..' });
  }
});

console.log('API launched on port', port);
app.listen(port);