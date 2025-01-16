require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const {
  MongoClient,
  ServerApiVersion,
  ObjectId,
  Timestamp,
} = require("mongodb");
const jwt = require("jsonwebtoken");
const morgan = require("morgan");

const port = process.env.PORT || 9000;
const app = express();
// middleware
const corsOptions = {
  origin: ["http://localhost:5173", "http://localhost:5174"],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));

const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.3jtn0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.mq0mae1.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const plantUserCollection = client
      .db("plantStore")
      .collection("plant-user");
    const plantsCollection = client.db("plantStore").collection("plants");
    const ordersCollection = client.db("plantStore").collection("orders");

    app.post("/users/:email", async (req, res) => {
      const email = req.params.email;

      // to query by email
      const query = { email };

      // take user from body
      const user = req.body;
      const isExist = await plantUserCollection.findOne(query);
      if (isExist) {
        return res.send("user exist");
      }
      const result = await plantUserCollection.insertOne({
        ...user,
        role: "customer",
        Timestamp: Date.now(),
      });
      res.send(result);
    });

    // post plants
    app.post("/plants", verifyToken, async (req, res) => {
      const plants = req.body;
      const result = await plantsCollection.insertOne(plants);
      res.send(result);
    });

    //     plants specific field update====
    app.patch("/plants/quantity/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      // update field comes from client by this name as quantityToUpdate====
      const { quantityToUpdate } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $inc: {
          quantity: -quantityToUpdate,
        },
      };
      const result = await plantsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // save order with customer details and seller email
    app.post("/orders", verifyToken, async (req, res) => {
      const orderInfo = req.body;
      const result = await ordersCollection.insertOne(orderInfo);
      res.send(result);
    });

    //     get order for specific customer===

    app.get("/customer-orders/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { "customer.email": email };
      const result = await ordersCollection
        .aggregate([
          {
            $match: query, //first match filed to aggregate with email or user..
          },
          {
            $addFields: {
              plantId: { $toObjectId: "$plantId" }, // convert string plantId to database objectId with add fields to set covertedid to db named plantId
            },
          },
          {
            $lookup: {
              //go to desired db as loolup
              from: "plants", //search to db named plants
              localField: "plantId", //field that local id like orders plantid
              foreignField: "_id", //searching id that to plants db by local id - plantid
              as: "plants", //return as array named plants
            },
          },
          {
            $unwind: "$plants", // convert plants array to objcect in order db with unwind
          },
          {
            $addFields: {
              //below fields are added to converted plants object
              name: "$plants.name",
              image: "$plants.image",
              category: "$plants.category",
            },
          },
          {
            $project: {
              //delet plants whole object by project operator
              plants: 0, //0 menas delete from db
            },
          },
        ])
        .toArray();
      res.send(result);
    });

    //     order delete by id==
    app.delete("/orders/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const order = await ordersCollection.findOne(query)

      if (order?.status === "delivered")
        return res.status(409).send("cant cancellation after delivered");

      const result = await ordersCollection.deleteOne(query);
      res.send(result);
    });

    // get all plants
    app.get("/plants", async (req, res) => {
      const result = await plantsCollection.find().toArray();
      res.send(result);
    });

    // get a plant by id
    app.get("/plants/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await plantsCollection.findOne(query);
      res.send(result);
    });
    // Generate jwt token
    app.post("/jwt", async (req, res) => {
      const email = req.body;
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    // Logout
    app.get("/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
      } catch (err) {
        res.status(500).send(err);
      }
    });

    // Send a ping to confirm a successful connection
    // await client.db('admin').command({ ping: 1 })
    // console.log(
    //   'Pinged your deployment. You successfully connected to MongoDB!'
    // )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from plantNet Server..");
});

app.listen(port, () => {
  console.log(`plantNet is running on port ${port}`);
});
