const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const MongoClient = require('mongodb').MongoClient;
const { ObjectID } = require('mongodb');
const assert = require('assert');

const app = express();
const url = process.env.MONGODB_URI || 'mongodb://localhost:' + 27017 + '/notes';
const dbName = "notes";
const client = new MongoClient(url, { useUnifiedTopology: true });

function initApiEndpoints({ attachTo: app, db }) {
  assert('get' in (app || {}), 'attachTo parameter should be an express Router');
  assert('collection' in (db || {}), 'db parameter should be a MongoDB connection');

const BADREQUEST = 400;
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const NOTFOUND = 404;
const SUCCESS = 200;
const CREATED = 201;

const SALTROUND = 12;

const JWT_KEY = process.env.JWT_KEY || 'secret';
const JWT_EXPIRY = 24 * 60 * 60;

app.use(express.json());

const log = console.log;

async function getCol(colName) {
  //const db = client.db(dbName);
  return db.collection(colName);
}

async function findUser(username){
  const col = await getCol('users');
  const user = await col.findOne({ username: username });
  return user == null ? false : user; 
}

async function findUserByid(id){
  const col = await getCol('users');
  return col.findOne({ _id: ObjectID(id) });
}

function makeToken(id){
  return jwt.sign({ id }, JWT_KEY, { expiresIn: JWT_EXPIRY })
}

async function authenticateToken(token){
  try{
    return jwt.verify(token, JWT_KEY);
  }catch(e){
    return null;
  }
}

(async function() {
try {
  await client.connect();
  //og('Connected to ' + dbName)
} catch (err) { log(err.stack); }
})();

// respond with "hello world" when a GET request is made to the homepage
app.get('/', function(req, res) {
  res.send('hello world');
});

app.post('/signup', async (req, res) => {
  let username = req.body.username != undefined? req.body.username : null;
  let password = req.body.password != undefined? req.body.password : null;
  let user = await findUser(username);
  if(!password || password.length < 4 ){
    res.status(BADREQUEST).send({ error : "Le mot de passe doit contenir au moins 4 caractères", token: undefined });
    return;
  }
  if(!username || username.length < 2 || username.length > 20){
    res.status(BADREQUEST).send({ error : "Votre identifiant doit contenir entre 2 et 20 caractères", token: undefined });
    return;
  }
  if(!username.match(/^[a-z]+$/)){
    res.status(BADREQUEST).send({ error : "Votre identifiant ne doit contenir que des lettres minuscules non accentuées", token: undefined });
    return;
  }
  if(user){
    res.status(BADREQUEST).send({ error : "Cet identifiant est déjà associé à un compte", token: undefined });
    return;
  }
  bcrypt.hash(password, SALTROUND, async (err, hash) => {
    if(err) res.status(500).send(err.message);
    const { insertedId } = await((await getCol('users')).insertOne({
      username: username,
      password: hash
    }));
    res.status(SUCCESS).send({
      error: null,
      token: makeToken(insertedId)
    });
  });
})

app.post('/signin',async (req, res) => {
  let username = req.body.username != undefined? req.body.username : null;
  let password = req.body.password != undefined? req.body.password : null;
  if(!password || password.length < 4 ){
    res.status(BADREQUEST).send({ error : "Le mot de passe doit contenir au moins 4 caractères", token: undefined });
    return;
  }
  if(!username || username.length < 2 || username.length > 20){
    res.status(BADREQUEST).send({ error : "Votre identifiant doit contenir entre 2 et 20 caractères", token: undefined });
    return;
  }
  if(!username.match(/^[a-z]+$/)){
    res.status(BADREQUEST).send({ error : "Votre identifiant ne doit contenir que des lettres minuscules non accentuées", token: undefined });
    return;
  }
  let user = await findUser(username);
  if (user === false) {
    res.status(FORBIDDEN).send({ error : 'Cet identifiant est inconnu', token: undefined });
    return;
  }else{
    await bcrypt.compare(password, user.password, function(err, result) {
      if (result === true) {
        res.status(SUCCESS).send({
          error: null,
          token: makeToken(user._id),
        });
      }else {
        res.status(FORBIDDEN).send({ error : 'Cet identifiant est inconnu', token: undefined });
        return;
      }
    });
  }
});

app.get('/notes', async (req, res) => {
    const token = req.get('x-access-token');
    if(!token) return res.status(401).json('Unauthorize user');
    const col = await getCol('notes');
    const decoded = await authenticateToken(token);
    if(!decoded){
  	  res.status(UNAUTHORIZED).send({error: "Utilisateur non connecté"});
  	  return;
    }
    const user = await findUserByid(decoded.id);
    res.status(SUCCESS).send({
      error: null,
      notes: await col.find({ userId: user._id }).toArray(),
    });
  });

app.put('/notes', async (req, res) => {
  const token = req.get('x-access-token');
  if(!token) return res.status(401).json('Unauthorize user');
  const decoded = await authenticateToken(token);
  if(!decoded){
  	res.status(UNAUTHORIZED).send({error: "Utilisateur non connecté"});
  	return;
  }
  const user = await findUserByid(decoded.id);
  if(!user) return res.status("User not found");
  if(req.body.content != undefined) {
    const note = {
      userId: user._id,
      content: req.body.content
    }
    const col = await getCol('notes');
    const { insertedId } = await col.insertOne(note);
    res.status(SUCCESS).send({
      error: null,
      note: {
        id: insertedId,
        ...note,
      }
    });
  } else {
    res.status(500).send("Internal server error.");
  }
})

app.patch('/notes/:id', async (req, res) => {
  const token = req.get('x-access-token');
  if(!token) return res.status(UNAUTHORIZED).json('Unauthorize user');
  const col = await getCol('notes');
  const decoded = await authenticateToken(token);
  if(!decoded){
  	res.status(UNAUTHORIZED).send({error: "Utilisateur non connecté"});
  	return;
  }
  const user = await findUserByid(decoded.id);
  const note = await col.findOne({ _id: ObjectID(req.params.id) });
  if (!note) {
    res.status(NOTFOUND).send({ error: 'Cet identifiant est inconnu' });
    return;
  }
  if (note.userId.toString() !== user._id.toString()) {
    res.status(FORBIDDEN).json({ error: "Accès non autorisé à cette note" });
  }
  if(req.body.content != undefined) {
    await col.updateOne(
      { _id: ObjectID(req.params.id) },
      {$set: req.body }
    );
    const _note = await col.findOne({ _id: ObjectID(req.params.id) });
    res.status(SUCCESS).send({
      error: null,
      note: _note,
    });
  } else {
    res.status(500).send("Internal server error.");
  }
})

app.delete('/notes/:id', async (req, res) => {
  const token = req.get('x-access-token');
  if(!token) return res.status(401).json('Unauthorize user');
  const col = await getCol('notes');
  const decoded = await authenticateToken(token);
  if(!decoded){
  	res.status(UNAUTHORIZED).send({error: "Utilisateur non connecté"});
  	return;
  }
  const user = await findUserByid(decoded.id);
  const id = { _id: ObjectID(req.params.id) };
  const note = await col.findOne(ObjectID(req.params.id));
  if (!note) {
    res.status(NOTFOUND).send({ error: "Cet identifiant est inconnu" });
    return;
  }
  if (note.userId.toString() !== user._id.toString()) {
    res.status(FORBIDDEN).send({ error: "Accès non autorisé à cette note" });
    return;
  }
  await col.deleteOne(id);
  res.status(SUCCESS).send({ error: null });
});
}

module.exports = initApiEndpoints;