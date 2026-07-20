import React, { useState } from 'react';

const Wallet = () => {
  const [walletAddress, setWalletAddress] = useState('');
  const [balance, setBalance] = useState(0);
  const [transactionHistory, setTransactionHistory] = useState([]);
  const [isAddingFunds, setIsAddingFunds] = useState(false);
  const [amountToAdd, setAmountToAdd] = useState('');

  // Sample transaction history (in a real app, this would come from backend)
  const sampleTransactions = [
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
  ];

  // Initialize wallet on mount
  // In a real app, this would fetch from backend/local storage
  // For demo, we'll use sample data
  // useEffect(() => {
  //   const loadWallet = async () => {
  //     try {
  //       // Fetch wallet data from backend
  //     } catch (error) {
  //       console.error('Failed to load wallet:', error);
  //     }
  //   };
  //   loadWallet();
  // }, []);

  const handleGenerateWallet = () => {
    // In a real app, this would generate a wallet address
    // For demo, we'll generate a mock address
    const mockAddress = '0x' + Math.random().toString(16).substr(2, 40);
    setWalletAddress(mockAddress);
    setBalance(0);
    setTransactionHistory([]);
  };

  const handleAddFunds = async () => {
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
  };

  const handleWithdraw = async (amount) => {
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
  };

  if (!walletAddress) {
    return (
      <div className="wallet-container">
        <div className="wallet-card">
          <h2>Wallet</h2>
          <p>Your secure cryptocurrency wallet for storing earnings from the multi-agent system.</p>
          <button className="btn-primary" onClick={handleGenerateWallet}>
            Create Wallet
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wallet-container">
      <div className="wallet-header">
        <h2>My Wallet</h2>
        <div className="wallet-actions">
          <button className="btn-secondary" onClick={handleGenerateWallet}>
            Create New Wallet
          </button>
        </div>
      </div>

      <div className="wallet-balance">
        <div className="balance-title">Wallet Balance</div>
        <div className="balance-amount">${balance.toFixed(2)}</div>
        <div className="wallet-address">
          <span>Address: {walletAddress}</span>
          {/* In a real app, you'd have a copy to clipboard button here */}
        </div>
      </div>

      <div className="wallet-section">
        <h3>Add Funds</h3>
        <form className="add-funds-form" onSubmit={(e) => {
          e.preventDefault();
          handleAddFunds();
        }}>
          <div className="form-group">
            <label htmlFor="amount">Amount ($)</label>
            <input
              type="number"
              id="amount"
              value={amountToAdd}
              onChange={(e) => setAmountToAdd(e.target.value)}
              placeholder="Enter amount to add"
              min="0.01"
              step="0.01"
              required
              disabled={isAddingFunds}
            />
          </div>
          <button
            type="submit"
            className="btn-primary"
            disabled={isAddingFunds || !amountToAdd || parseFloat(amountToAdd) <= 0}
          >
            {isAddingFunds ? 'Adding...' : 'Add Funds'}
          </button>
        </form>
      </div>

      <div className="wallet-section">
        <h3>Transaction History</h3>
        {transactionHistory.length > 0 ? (
          <div className="transaction-list">
            {transactionHistory.map(tx => (
              <div key={tx.id} className={`transaction-item ${tx.type}`}>
                <div className="transaction-info">
                  <span className="transaction-type">
                    {tx.type === 'deposit' ? 'Deposit' : tx.type === 'withdrawal' ? 'Withdrawal' : 'Earning'}
                  </span>
                  <span className="transaction-description">{tx.description}</span>
                </div>
                <div className="transaction-amount">
                  {tx.type === 'deposit' ? `+$${tx.amount.toFixed(2)}` :
                   tx.type === 'withdrawal' ? `-$${Math.abs(tx.amount).toFixed(2)}` :
                   `$${tx.amount.toFixed(2)}`}
                </div>
                <div className="transaction-time">
                  {new Date(tx.timestamp).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">No transactions yet. Start earning with your agents to see transactions here.</p>
        )}
      </div>

      <div className="wallet-section">
        <h3>Quick Actions</h3>
        <div className="quick-actions">
          <button className="btn-outline" onClick={() => handleWithdraw(25)}>
            Withdraw $25
          </button>
          <button className="btn-outline" onClick={() => handleWithdraw(50)}>
            Withdraw $50
          </button>
          <button className="btn-outline" onClick={() => handleWithdraw(100)}>
            Withdraw $100
          </button>
        </div>
      </div>
    </div>
  );
};

export default Wallet;