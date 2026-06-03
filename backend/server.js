
const express=require('express');
const cors=require('cors');

const app=express();
app.use(cors());

function rand(min,max){
 return (Math.random()*(max-min)+min).toFixed(2);
}

app.get('/api/live',(req,res)=>{
 const symbol=req.query.symbol || 'XAUUSD';

 res.json({
   symbol,
   SMN:(Math.random()*-12000).toFixed(0),
   POWER:rand(-5000,5000),
   DELTA:(Math.random()*-3000).toFixed(0),
   RSI:rand(30,70),
   ATR:rand(4,12),
   PHASE:['ACCUMULATION','DISTRIBUTION','TRENDING','RANGING'][Math.floor(Math.random()*4)],
   GRADE:['A','A+','B','C'][Math.floor(Math.random()*4)]
 });
});

const PORT=process.env.PORT || 3000;

app.listen(PORT,()=>{
 console.log('VYRO realtime running on '+PORT);
});
