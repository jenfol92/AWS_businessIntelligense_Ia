import test from 'node:test';
import assert from 'node:assert/strict';
import {assertAmazonObservationSchemaError,AmazonObservationSchemaError} from '../utils/amazonObservationSchema.ts';
test('missing RPC or FX columns produce actionable schema error without SQL detail',()=>{
 for(const code of ['PGRST202','PGRST204','42703','42883'])assert.throws(()=>assertAmazonObservationSchemaError({code,message:'private SQL detail'}),e=>e instanceof AmazonObservationSchemaError && !e.message.includes('private SQL detail'));
});
test('success continues and other errors do not masquerade as a migration issue',()=>{
 assert.doesNotThrow(()=>assertAmazonObservationSchemaError(null));
 assert.throws(()=>assertAmazonObservationSchemaError({code:'42501',message:'permission denied'}),e=>!(e instanceof AmazonObservationSchemaError));
});
