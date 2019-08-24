
function setup(rocketh, ethers) {
    if(!rocketh) {
        throw new Error("rocketh-ethers expect to be passed rocketh module as first argument");
    }
    if(!ethers) {
        throw new Error("rocketh-ethers expect to be passed ethers module as second argument");
    }
    const provider = new ethers.providers.Web3Provider(rocketh.ethereum);
    const signer = provider.getSigner();

    const deploy = async(name, options, contractName, ...args) => {
        let register = true;
        if(typeof name != 'string') {
            register = false;
            args.unshift(contractName);
            contractName = options;
            options = name;
        }
        const ContractInfo = rocketh.contractInfo(contractName);
        const factory = new ethers.ContractFactory(ContractInfo.abi, '0x' + ContractInfo.evm.bytecode.object, signer);
        
        
        let contract;
        let transactionHash;
        if(options.from.length > 42) {
            const deployData = factory.getDeployTransaction(...args);
            console.log(JSON.stringify(deployData, null, '  '));
            const txOptions = {
                from: options.from,
                data: deployData,
                gas: options.gas,
                gasPrice: options.gasPrice,
                value: options.value,
                nonce: options.nonce
            };
            const receipt = await tx(txOptions);
            transactionHash = receipt.transactionHash;
            contract = new ethers.Contract(receipt.contractAddress, ContractInfo.abi, provider);
        } else {
            contract = await factory.deploy(...args);
            transactionHash = contract.deployTransaction.hash;
            await contract.deployed();
        }

        
        if(register) {
            rocketh.registerDeployment(name, { 
                contractInfo: ContractInfo, 
                address: contract.address,
                transactionHash,
                args
            });
        }

        const receipt = await fetchReceipt(transactionHash);
        return {
            contract: {
                address: contract.address,
                abi: ContractInfo.abi,
                _ethersContract: contract
            },
            transactionHash,
            receipt
        };
    }

    const deployIfNeverDeployed = async (name, options, contractName, ...args) => {
        const deployment = rocketh.deployment(name);
        if(!deployment) {
            return deploy(name, options, contractName, ...args);
        } else {
            return getDeployedContractWithTransactionHash(name);
        }
    }

    const fetchIfDifferent = async (fieldsToCompare, name, options, contractName, ...args) => {
        const deployment = rocketh.deployment(name);
        if(deployment) {
            const transaction = await provider.getTransaction(deployment.transactionHash);
            if(transaction) {
                const ContractInfo = rocketh.contractInfo(contractName);
                const factory = new ethers.ContractFactory(ContractInfo.abi, '0x' + ContractInfo.evm.bytecode.object, signer);

                const compareOnData = fieldsToCompare.indexOf('data') != -1;
                const compareOnInput = fieldsToCompare.indexOf('input') != -1;

                let data;
                if(compareOnData || compareOnInput) {
                    data = factory.getDeployTransaction(...args);
                    console.log(JSON.stringify(data, null, '  '));
                }
                const newTransaction = {
                    data: compareOnData ? data : undefined,
                    input: compareOnInput ? data : undefined,
                    gas: options.gas,
                    gasPrice: options.gasPrice,
                    value: options.value,
                    from: options.from
                };

                transaction.data = transaction.input;
                for(let i = 0; i < fieldsToCompare.length; i++) {
                    const field = fieldsToCompare[i];
                    if(typeof newTransaction[field] == 'undefined') {
                        throw new Error('field ' + field + ' not specified in new transaction, cant compare');
                    }
                    if(transaction[field] != newTransaction[field]) {
                        return true;
                    }
                }
                return false; 
            }
        }
        return true;
    }

    const deployIfDifferent = async (fieldsToCompare, name, options, contractName, ...args) => {
        const differences = await fetchIfDifferent(fieldsToCompare, name, options, contractName, ...args);
        if(differences) {
            return deploy(name, options, contractName, ...args);
        } else {
            return getDeployedContractWithTransactionHash(name);
        }
        
    };

    function fromDeployment(deployment) {
        return {address: deployment.address, abi: deployment.contractInfo.abi, _ethersContract: new ethers.Contract(deployment.address, deployment.contractInfo.abi, signer)};
    }

    async function getDeployedContractWithTransactionHash(name) {
        const deployment = rocketh.deployment(name);
        if(!deployment) {
            return null;
        }
        const receipt = await fetchReceipt(deployment.transactionHash);
        return {contract: fromDeployment(deployment), transactionHash: deployment.transactionHash, receipt};
    }

    function getDeployedContract(name) {
        const deployment = rocketh.deployment(name);
        if(!deployment) {
            return null;
        }
        return fromDeployment(deployment)
    }

    function registerContract(name, address, txHash, contractName, ...args) {
        const ContractInfo = rocketh.contractInfo(contractName);
        rocketh.registerDeployment(name, { 
            contractInfo: ContractInfo, 
            address,
            transactionHash: txHash,
            args
        });
        return {addresss, abi: ContractInfo.abi};
    }


    function overrides(options) {
        return {
            gasLimit: options.gas,
            // from: options.from,
        }
    }
    async function tx(options, contract, methodName, ...args) {
        if(options.from.length > 42) {
            const privateKey = options.from;
            const fromWallet = new ethers.Wallet(privateKey);
            const from = fromWallet.address;
            const nonce = options.nonce || await proivder.getTransactionCount(from);
            const gas = options.gas;
            const value = options.value || "0x0";
            const gasPrice = options.gasPrice || await provider.getGasPrice();
            let data = options.data;
            let to = options.to;
            if(contract) {
                to = contract.address;
                data = contract.functions[methodName].encode(...args);
                console.log(JSON.stringify(data, null, '  '));
            }
            const txOptions = {
                from,
                nonce,
                gas,
                value,
                gasPrice,
                data,
                to
            };
            const signedTx = await signer.signTransaction(txOptions, privateKey);
            return web3.eth.sendSignedTransaction(signedTx.rawTransaction);                    
        } else {
            if(contract) {
                return contract._ethersContract.functions[methodName](...args, overrides(options));
            } else {
                return provider.sendTransaction(options);
            }
        }
    }

    function estimateGas(options, contract, methodName, ...args) {
        if(typeof args == "undefined") {
            args = [];
        }
        if(typeof contract == "string") {
            args = args.concat([]);
            if(typeof methodName != "undefined") {
                args.unshift(methodName);
            }
            methodName = contract;
            contract = options;
            options = {};
        }
        return contract._ethersContract.estimate[methodName](...args, overrides(options));
    }

    function call(options, contract, methodName, ...args) {
        if(typeof args == "undefined") {
            args = [];
        }
        if(typeof contract == "string") {
            args = args.concat([]);
            if(typeof methodName != "undefined") {
                args.unshift(methodName);
            }
            methodName = contract;
            contract = options;
            options = {};
        }
        return contract._ethersContract.functions[methodName](...args, overrides(options));
    }

    function encodeABI(contract, methodName, ...args) {
        // console.log(methodName, args);
        const data = contract._ethersContract.interface.functions[methodName].encode(args);
        // console.log(JSON.stringify(data, null, '  '));
        return data;
    }

    function fetchReceipt(txHash) {
        return provider.getTransactionReceipt(txHash);
    }

    // from https://github.com/OpenZeppelin/zeppelin-solidity/blob/master/test/helpers/expectThrow.js
    // Changing to use the invalid opcode error instead works
    async function expectThrow (promise) {
        let receipt;
        try {
        receipt = await promise;
        } catch (error) {
        // TODO: Check jump destination to destinguish between a throw
        //       and an actual invalid jump.
        const invalidOpcode = error.message.search('invalid opcode') >= 0;
        // TODO: When we contract A calls contract B, and B throws, instead
        //       of an 'invalid jump', we get an 'out of gas' error. How do
        //       we distinguish this from an actual out of gas event? (The
        //       ganache log actually show an 'invalid jump' event.)
        const outOfGas = error.message.search('out of gas') >= 0;
        const revert = error.message.search('revert') >= 0;
        const status0x0 = error.message.search('status": "0x0"') >= 0 ||  error.message.search('status":"0x0"') >= 0; // TODO better
        assert(
            invalidOpcode || outOfGas || revert || status0x0,
            'Expected throw, got \'' + error + '\' instead',
        );
        return;
        }
        if(receipt.status == "0x0") {
        return;
        }
        assert.fail('Expected throw not received');
    }

    return {
        encodeABI,
        fetchIfDifferent,
        deployIfDifferent,
        getDeployedContract,
        deployIfNeverDeployed,
        registerContract,
        deploy,
        tx,
        fetchReceipt,
        call,
        expectThrow,
        estimateGas,
        getTransactionCount: (from) => provider.getTransactionCount(from),
        getBalance: (from) => provider.getBalance(from),
        zeroBytes: '0x',
        getEventSignature: (abi, name)=> {
            (new ethers.utils.Interface(abi)).events[name].signature;
        }
    };
}

module.exports = setup;
