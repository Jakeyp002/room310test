# Room310 · Build your first neural network
# Original teaching examples. Run top to bottom.
# Requires PyTorch; CPU is enough.

# The XOR puzzle
import torch
from torch import nn

torch.manual_seed(7)
X = torch.tensor([[0.0, 0.0], [0.0, 1.0], [1.0, 0.0], [1.0, 1.0]])
y = torch.tensor([[0.0], [1.0], [1.0], [0.0]])
print("Inputs:", X.shape, "Targets:", y.shape)

# Two layers and a bend in the middle
model = nn.Sequential(
    nn.Linear(2, 8),
    nn.Tanh(),
    nn.Linear(8, 1),
)
loss_fn = nn.BCEWithLogitsLoss()
optimizer = torch.optim.Adam(model.parameters(), lr=0.03)

print(model)
print("Trainable parameters:", sum(p.numel() for p in model.parameters()))

# Train, then inspect each prediction
model.train()
for epoch in range(400):
    optimizer.zero_grad()
    logits = model(X)
    assert logits.shape == y.shape
    loss = loss_fn(logits, y)
    loss.backward()
    optimizer.step()
    if epoch % 100 == 0:
        print(f"Epoch {epoch:3d} | loss before update: {loss.item():.4f}")

model.eval()
with torch.no_grad():
    probabilities = torch.sigmoid(model(X))
    predictions = (probabilities >= 0.5).float()
    accuracy = (predictions == y).float().mean().item()
for inputs, probability, predicted, target in zip(X, probabilities, predictions, y):
    print(inputs.tolist(), f"p(1)={probability.item():.3f}",
          "prediction=", int(predicted.item()), "target=", int(target.item()))
print(f"Training accuracy: {accuracy:.0%}")
