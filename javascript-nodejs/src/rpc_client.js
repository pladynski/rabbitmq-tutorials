#!/usr/bin/env node

const { GraftConfig, FibonacciService } = require('@graft/npm-rabbitmq-node-tutorial');

GraftConfig.host = process.env.RPC_SERVER_GRAFT_HOST || 'ws://localhost:9090/ws';

const args = process.argv.slice(2);

if (args.length === 0) {
    console.log("Usage: rpc_client.js num");
    process.exit(1);
}

async function main() {
    const num = parseInt(args[0]);

    console.log(' [x] Requesting fib(%d)', num);

    const result = (await FibonacciService.fib(num)).toString();

    console.log(' [.] Got %s', result);
    process.exit(0);
}

main();
