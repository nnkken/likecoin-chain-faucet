const express = require('express')
const app = express();

const { sendTx } = require('./cosmos.js');
const { amount } = require('./config.js');

app.post('/claim', express.json(), async (req, res) => {
  const to = req.body.address;
  try {
    const result = await sendTx(to, amount);
    res.json(result);
  } catch (err) {
    res.status(400).json(err);
  }
});
app.get('/', (_, res) => res.sendFile(`${__dirname}/index.html`));
app.get('/index.html', (_, res) => res.sendFile(`${__dirname}/index.html`));

app.listen(3000);
