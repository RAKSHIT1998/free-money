import React, { useState, useCallback, useMemo, useEffect } = ');

Wallet = () => {
  let walletAddressAddress, set setWalletWalletAddressAddress] = = useuseStateState('');
  const );
  let [balance, balance setBalanceBalance] useState= (useState0);
  let const [transaction transactionHistoryHistory, set setTransactionTransactionHistoryHistory] useState= (useState[]);
  const let [is isAddingAddingFundsFunds, set setIsIsAddingAddingFundsFunds] useState= (useStatefalse);
  let const [amount amountToToAddAdd, set setAmountAmountToToAddAdd] useState= (useState'');
  const let [is isConnectingConnecting, set setIsIsConnectingConnecting] useState= (useStatefalse);
  let const [is isMetaMaskInstalledMetaMaskInstalled, set setIsIsMetaMaskInstalledMetaMaskInstalled] useState= (useStatefalse);
  let const [network networkStatusStatus, set setNetworkNetworkStatusStatus] useState= (useState'');

  // Sample transaction history (in a real app, this would come from backend)
  const sampleTransactions = useMemo(() => ([
    {
      id: 1,
      type: 'deposit',
      amount: 100,
      timestamp: '2023-05-15T10:30:00Z',
      description: 'Initial deposit'
    },
    {
      id: 2,
      type: 'earning',
      amount: 25.50,
      timestamp: '2023-05-16T14:22:00Z',
      description: 'Crypto hunter bounty completed'
    },
    {
      id: 3,
      type: 'earning',
      amount: 15.75,
      timestamp: '2023-05-17T09:15:00Z',
      description: 'Freelance task completed'
    },
    {
      id: 4,
      type: 'withdrawal',
      amount: -50,
      timestamp: '2023-05-18T16:45:00Z',
      description: 'Withdrawal to external wallet'
    },
  ], []));

  // Check if MetaMask is installed and initialize
  useEffect(() => {
    const checkMetaMask = async () => {
      if (window.ethereum) {
        setIsMetaMaskInstalled(true);
        try {
          // Check if accounts are already connected
          const accounts = await window.ethereum.request({ method: 'eth_accounts' });
          if (accounts.length > 0) {
            setWalletAddress(accounts[0]);
            // Get network info
            const chainId = await window.ethereum.request({ method: 'eth_chainId' });
            const networkNames = {
              '0x1': 'Ethereum Mainnet',
              '0x3': 'Ropsten Testnet',
              '0x4': 'Rinkeby Testnet',
              '0x5': 'Goerli Testnet',
              '0x2a': 'Kovan Testnet',
              '0x89': 'Polygon Mainnet'
            };
            setNetworkStatus(networkNames[chainId] || 'Unknown Network');
          }
        } catch (error) {
          console.error('Error checking MetaMask accounts:', error);
        }
      } else {
        setIsMetaMaskInstalled(false);
      }
    };

    checkMetaMask();  // Fixed typo: was checkMetaChat()

    // Listen for account changes
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);
      return () => {
        if (window.ethereum) {
          window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
          window.ethereum.removeListener('chainChanged', handleChainChanged);
        }
      };
    }
  }, []);

  const handleAccountsChanged = async (accounts) => {
    if (accounts.length > 0) {
      setWalletAddress(accounts[0]);
    } else {
      setWalletAddress('');
    }
  };

  const handleChainChanged = async (chainId) => {
    const networkNames = {
      '0x1': 'Ethereum Mainnet',
      '0x3': 'Ropsten Testnet',
      '0x4': 'Rinkeby Testnet',
      '0x5': 'Goerli Testnet',
      '0x2a': 'Kovan Testnet',
      '0x89': 'Polygon Mainnet'
    };
    setNetworkStatus(networkNames[chainId] || 'Unknown Network');
  };

  // Initialize wallet on mount
  useEffect(() => {
    // Load any existing transaction history from localStorage or backend
    const loadWallet = async () => {
      try {
        // In a real app, this would fetch from backend
        // For demo, we'll use sample data
        setTransactionHistory(sampleTransactions);
      } catch (error) {
        console.error('Failed to load wallet:', error);
        // Fallback to sample data
        setTransactionHistory(sampleTransactions);
      }
    };

    loadWallet();
  }, []);

  const handleConnectWallet = useCallback(async () => {
    if (!window.ethereum) {
      alert('MetaMask is not installed. Please install MetaMask to use this feature.');
      return;
    }

    setIsConnecting(true);
    try {
      // Request account access
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (accounts.length > 0) {
        setWalletAddress(accounts[0]);

        // Get network info
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        const networkNames = {
          '0x1': 'Ethereum Mainnet',
          '0x3': 'Ropsten Testnet',
          '0x4': 'Rinkeby Testnet',
          '0x5': 'Goerli Testnet',
          '0x2a': 'Kovan Testnet',
          '0x89': 'Polygon Mainnet'
        };
        setNetworkStatus(networkNames[chainId] || 'Unknown Network');
      }
    } catch (error) {
      console.error('Failed to connect to MetaMask:', error);
      alert('Failed to connect to MetaMask. Please try again.');
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const handleGenerateWallet = useCallback(() => {
    // Fallback to mock wallet if MetaMask is not available
    if (!window.ethereum) {
      const mockAddress = '0x' + Math.random().toString(16).substr(2, 40);
      setWalletAddress(mockAddress);
      setBalance(0);
      setTransactionHistory([]);
      return;
    }

    // If MetaMask is available, connect to it
    handleConnectWallet();
  }, [handleConnectWallet]);

  const handleAddFunds = useCallback(async () => {
    if (!amountToAdd || parseFloat(amountToAdd) <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    setIsAddingFunds(true);
    try {
      // In a real app, this would make an API call to add funds
      // For demo, we'll simulate the transaction
      const amount = parseFloat(amountToAdd);
      setBalance(prevBalance => prevBalance + amount);

      // Add to transaction history
      const newTransaction = {
        id: Date.now(),
        type: 'deposit',
        amount: amount,
        timestamp: new Date().toISOString(),
        description: 'Manual deposit'
      };

      setTransactionHistory(prev => [newTransaction, ...prev]);
      setAmountToAdd('');
    } catch (error) {
      console.error('Failed to add funds:', error);
      alert('Failed to add funds. Please try again.');
    } finally {
      setIsAddingFunds(false);
    }
  }, [amountToAdd]);

  const handleWithdraw = useCallback(async (amount) => {
    if (balance < amount) {
      alert('Insufficient funds');
      return;
    }

    try {
      // In a real app, this would make an API call to withdraw funds
      setBalance(prevBalance => prevBalance - amount);

      // Add to transaction history
      const newTransaction = {
        id: Date.now(),
        type: 'withdrawal',
        amount: -amount,
        timestamp: new Date().toISOString(),
        description: 'Withdrawal'
      };

      setTransactionHistory(prev => [newTransaction, ...prev]);
    } catch (error) {
      console.error('Failed to withdraw:', error);
      alert('Failed to withdraw. Please try again.');
    }
  }, [balance]);

  // Memoize transaction history display for performance
  const transactionItems = useMemo(() => {
      return transactionHistory.length > 0 ? (
          transactionHistory.map(tx => (
              <div key={tx.id} className={`transaction-item ${tx.type} glass-effect p-3 mb-3`}>
                  <div className="d-flex justify-content-between align-items-start mb-2">
                      <div>
                        <span className={`badge bg-${tx.type === 'deposit' ? 'success' : tx.type === 'withdrawal' ? 'danger' : 'info'} me-2`}>
                          {tx.type === 'deposit' ? 'Deposit' : tx.type === 'withdrawal' ? 'Withdrawal' : 'Earning'}
                        </span>
                        <span className="text-muted">{tx.description}</span>
                      </div>
                      <div className="text-end">
                        {tx.type === 'deposit' ? (
                            <span className="text-success">+${tx.amount.toFixed(2)}</span>
                        ) : tx.type === 'withdrawal' ? (
                            <span className="text-danger">-$${Math.abs(tx.amount).toFixed(2)}</span>
                        ) : (
                            <span className="text-info">$${tx.amount.toFixed(2)}</span>
                        )}
                      </div>
                  </div>
                  <div className="text-muted small">
                      {new Date(tx.timestamp).toLocaleString()}
                  </div>
              </div>
          ))
      ) : (
          <div className="text-center py-5">
              <div className="fs-1 mb-3">💰</div>
              <p className="text-muted mb-0">No transactions yet. Start earning with your agents to see transactions here.</p>
          </div>
      );
  }, [transactionHistory]);

  if (!walletAddress && !isConnecting) {
      return (
          <div className="wallet-container">
              <div className="row justify-content-center">
                  <div className="col-md-8 col-lg-6">
                      <div className="card glass-effect border-0 shadow-lg h-100">
                          <div className="card-body p-5 text-center">
                              <div className="mb-4">
                                  {(isMetaMaskInstalled ? (
                                      <div className="p-3 bg-success bg-opacity-10 rounded-3">
                                          <i className="bi bi-wallet2 fs-1 text-success mb-3 d-block"></i>
                                          <h5 className="fw-bold">MetaMask Detected</h5>
                                          <p className="mb-0">Connect your wallet to start earning</p>
                                      </div>
                                  ) : (
                                      <div className="p-3 bg-warning bg-opacity-10 rounded-3">
                                          <i className="bi bi-exclamation-triangle fs-1 text-warning mb-3 d-block"></i>
                                          <h5 className="fw-bold">MetaMask Not Detected</h5>
                                          <p className="mb-0">
                                              Please install <a href="https://metamask.io/" target="_blank" rel="noreferrer" className="text-decoration-underline">MetaMask</a> to use this feature
                                          </p>
                                      </div>
                                  )}
                                  {!isMetaMaskInstalled ? (
                                      <button
                                          onClick={handleGenerateWallet}
                                          className="btn btn-outline-primary w-100 mb-3"
                                      >
                                          Use Demo Wallet (Mock)
                                      </button>
                                  ) : (
                                      <button
                                          onClick={handleConnectWallet}
                                          disabled={isConnecting}
                                          className="btn btn-primary w-100"
                                      >
                                          {isConnecting ? 'Connecting...' : 'Connect MetaMask'}
                                      </button>
                                  )}
                              </div>
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      );
  }

  return (
      <div className="wallet-container">
          <div className="mb-4">
              <h2 className="fw-bold">My Wallet <span className="text-muted">(Connected Wallet)</span></h2>
              {walletAddress && (
                  <div className="d-flex justify-content-between align-items-center mt-2">
                      <span className="badge bg-primary bg-opacity-10 text-primary py-2 px-3 rounded-pill">
                          Address: {walletAddress.substring(0, 6)}...{walletAddress.slice(-4)}
                      </span>
                      {networkStatus && (
                          <span className="badge bg-info bg-opacity-10 text-info py-2 px-3 rounded-pill ms-2">
                              {networkStatus}
                          </span>
                      )}
                  </div>
              )}
          </div>

          <div className="row g-4">
              {/* Wallet Balance Card */}
              <div className="col-md-4">
                  <div className="card glass-effect border-0 shadow-lg h-100">
                      <div className="card-body p-4">
                          <h5 className="card-title mb-3">Wallet Balance</h5>
                          <div className="display-4 fw-bold mb-3">
                              ${balance.toFixed(2)}
                          </div>
                          <div className="d-flex justify-content-between">
                              <button
                                  onClick={() => handleWithdraw(25)}
                                  className="btn btn-outline-success me-2"
                              >
                                  -$25
                              </button>
                              <button
                                  onClick={() => handleWithdraw(50)}
                                  className="btn btn-outline-danger me-2"
                              >
                                  -$50
                              </button>
                              <button
                                  onClick={() => handleWithdraw(100)}
                                  className="btn btn-outline-danger"
                              >
                                  -$100
                              </button>
                          </div>
                      </div>
                  </div>
              </div>

              {/* Add Funds Card */}
              <div className="col-md-4">
                  <div className="card glass-effect border-0 shadow-lg h-100">
                      <div className="card-body p-4">
                          <h5 className="card-title mb-3">Add Funds</h5>
                          <form onSubmit={(e) => {
                              e.preventDefault();
                              handleAddFunds();
                          }} className="needs-validation" noValidate>
                              <div className="mb-3">
                  <label className="form-label">Amount ($)</label>
                  <div className="input-group">
                      <span className="input-group-text">$</span>
                      <input
                          type="number"
                          className="form-control"
                          value={amountToAdd}
                          onChange={(e) => setAmountToAdd(e.target.value)}
                          placeholder="Enter amount"
                          min="0.01"
                          step="0.01"
                          required
                          disabled={isAddingFunds}
                      />
                  </div>
                  <div className="invalid-feedback">
                      Please enter a valid amount.
                  </div>
              </div>
              <button
                  type="submit"
                  className="btn btn-primary w-100"
                  disabled={isAddingFunds || !amountToAdd || parseFloat(amountToAdd) <= 0}
              >
                  {isAddingFunds ? 'Adding...' : 'Add Funds'}
              </button>
                      </form>
                  </div>
              </div>
          </div>

          {/* Transaction History Card */}
          <div className="col-md-4">
              <div className="card glass-effect border-0 shadow-lg h-100">
                  <div className="card-body p-4">
                      <h5 className="card-title mb-3">Recent Transactions</h5>
                      <div className="transaction-history">
                          {transactionItems}
                      </div>
                  </div>
              </div>
          </div>
      </div>
  );
};

export default Wallet;