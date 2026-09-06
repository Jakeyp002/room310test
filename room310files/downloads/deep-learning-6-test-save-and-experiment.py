# Room310 · Test it, save it, make it yours
# Original teaching examples. Run top to bottom.
# Requires PyTorch; CPU is enough.

# Give the network examples it has not seen
import torch
from torch import nn

torch.manual_seed(7)
X = torch.rand(400, 2) * 2 - 1
y = (X[:, 0] * X[:, 1] < 0).float().reshape(-1, 1)
order = torch.randperm(len(X))
train_ids, val_ids, test_ids = order[:240], order[240:320], order[320:]
X_train, y_train = X[train_ids], y[train_ids]
X_val, y_val = X[val_ids], y[val_ids]
X_test, y_test = X[test_ids], y[test_ids]
print("Split sizes:", len(X_train), len(X_val), len(X_test))

# Use validation to understand learning
hidden_size = 16
learning_rate = 0.03
epochs = 400
model = nn.Sequential(nn.Linear(2, hidden_size), nn.Tanh(), nn.Linear(hidden_size, 1))
loss_fn = nn.BCEWithLogitsLoss()
optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate)

def evaluate(inputs, targets):
    model.eval()
    with torch.no_grad():
        logits = model(inputs)
        loss = loss_fn(logits, targets).item()
        predicted = (torch.sigmoid(logits) >= 0.5).float()
        accuracy = (predicted == targets).float().mean().item()
    return loss, accuracy

history = []
for epoch in range(epochs):
    model.train()
    optimizer.zero_grad()
    loss = loss_fn(model(X_train), y_train)
    loss.backward()
    optimizer.step()
    if (epoch + 1) % 100 == 0:
        train_loss, train_accuracy = evaluate(X_train, y_train)
        val_loss, val_accuracy = evaluate(X_val, y_val)
        history.append((epoch + 1, train_loss, val_loss))
        print(f"Epoch {epoch + 1} | train loss {train_loss:.3f} | "
              f"val loss {val_loss:.3f} | val accuracy {val_accuracy:.1%}")

# Do a final test and preserve what you learned
test_loss, test_accuracy = evaluate(X_test, y_test)
print(f"Final test | loss {test_loss:.3f} | accuracy {test_accuracy:.1%}")

torch.save({"hidden_size": hidden_size, "model_state": model.state_dict()},
           "room310_tiny_net.pt")
checkpoint = torch.load("room310_tiny_net.pt", map_location="cpu", weights_only=True)
restored = nn.Sequential(
    nn.Linear(2, checkpoint["hidden_size"]), nn.Tanh(),
    nn.Linear(checkpoint["hidden_size"], 1),
)
restored.load_state_dict(checkpoint["model_state"])
restored.eval()
with torch.no_grad():
    assert torch.allclose(model(X_test), restored(X_test))
    new_points = torch.tensor([[-0.8, 0.7], [0.7, 0.6]])
    probabilities = torch.sigmoid(restored(new_points))
print("Reload check passed. New p(class 1):", probabilities.flatten().tolist())
