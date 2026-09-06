# Room310 · How a model learns
# Original teaching examples. Run top to bottom.

# Give a mistake a number
prediction = 4.0
target = 7.0
loss = (prediction - target) ** 2
print("Squared error:", loss)

# Find which direction is downhill
def loss_at(weight):
    prediction = weight * 3.0 + 1.0
    return (prediction - 7.0) ** 2

weight = 0.0
epsilon = 0.0001
slope = (loss_at(weight + epsilon) - loss_at(weight - epsilon)) / (2 * epsilon)
new_weight = weight - 0.05 * slope
print("Slope:", round(slope, 3))
print("Loss before:", loss_at(weight))
print("Loss after:", round(loss_at(new_weight), 3))

# Repeat the update: a training loop
xs = [-2.0, -1.0, 0.0, 1.0, 2.0]
targets = [2 * x + 1 for x in xs]
weight, bias = 0.0, 0.0
learning_rate = 0.1

for epoch in range(60):
    errors = [weight * x + bias - y for x, y in zip(xs, targets)]
    loss = sum(error ** 2 for error in errors) / len(xs)
    grad_weight = sum(2 * error * x for error, x in zip(errors, xs)) / len(xs)
    grad_bias = sum(2 * error for error in errors) / len(xs)
    weight -= learning_rate * grad_weight
    bias -= learning_rate * grad_bias
    if epoch % 20 == 0:
        print(f"Epoch {epoch:2d} | loss before update: {loss:.6f}")

print(f"Learned weight: {weight:.3f}, bias: {bias:.3f}")
print(f"Prediction for x=3: {weight * 3 + bias:.3f}")
