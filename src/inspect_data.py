import pandas as pd

# Read the deployment dataset
df = pd.read_csv("data/deployments.csv")

# Display first five records
print("FIRST FIVE DEPLOYMENTS:")
print(df.head())

# Display dataset dimensions
print("\nDATASET SHAPE:")
print(df.shape)

# Display column information
print("\nDATASET INFORMATION:")
print(df.info())

# Check missing values
print("\nMISSING VALUES:")
print(df.isnull().sum())
# Check duplicate records
print("\nDUPLICATE RECORDS:")
print(df.duplicated().sum())

# Check invalid deployment durations
print("\nINVALID DURATIONS:")
print(df[df["duration_minutes"] <= 0])

# Convert date column into datetime format
df["date"] = pd.to_datetime(df["date"])

print("\nUPDATED DATA TYPES:")
print(df.dtypes)