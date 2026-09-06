# Room310 · Meet PyTorch & tensors
# Original teaching examples. Run top to bottom.
# Requires PyTorch; CPU is enough.

# Start with a real Python environment
import torch

torch.manual_seed(7)
print("PyTorch:", torch.__version__)
print("A tensor on:", torch.tensor([1.0]).device)

# A tensor is an array with a shape
X = torch.tensor([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]])
y = torch.tensor([[0.0], [1.0], [1.0]])

print("Input shape:", X.shape)
print("Target shape:", y.shape)
print("Input dtype:", X.dtype)
print("First example:", X[0])

# Run the same neuron on a whole batch
weights = torch.tensor([[0.5], [1.0]])
bias = torch.tensor(0.25)
predictions = X @ weights + bias

print("Predictions:", predictions)
assert predictions.shape == y.shape
print("One prediction per target:", predictions.shape)
