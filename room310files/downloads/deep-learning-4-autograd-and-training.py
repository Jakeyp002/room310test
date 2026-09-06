# Room310 · Let PyTorch find the gradients
# Original teaching examples. Run top to bottom.
# Requires PyTorch; CPU is enough.

# Autograd records the calculation
import torch

weight = torch.tensor(0.0, requires_grad=True)
bias = torch.tensor(1.0, requires_grad=True)
prediction = weight * 3.0 + bias
loss = (prediction - 7.0) ** 2
loss.backward()

print("Weight gradient:", weight.grad.item())
print("Bias gradient:", bias.grad.item())

# Predict → measure → backpropagate → update
X = torch.tensor([[-2.0], [-1.0], [0.0], [1.0], [2.0]])
y = 2 * X + 1
weight = torch.tensor(0.0, requires_grad=True)
bias = torch.tensor(0.0, requires_grad=True)
learning_rate = 0.1

for epoch in range(60):
    weight.grad = None
    bias.grad = None
    predictions = weight * X + bias
    assert predictions.shape == y.shape
    loss = ((predictions - y) ** 2).mean()
    loss.backward()
    with torch.no_grad():
        weight -= learning_rate * weight.grad
        bias -= learning_rate * bias.grad
    if epoch % 20 == 0:
        print(f"Epoch {epoch:2d} | loss before update: {loss.item():.6f}")

print(f"Learned weight: {weight.item():.3f}, bias: {bias.item():.3f}")

# Use the model without training it
with torch.no_grad():
    new_inputs = torch.tensor([[3.0], [4.0]])
    new_predictions = weight * new_inputs + bias
print("New predictions:", new_predictions.flatten().tolist())
