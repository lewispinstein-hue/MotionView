# 
# Programmed using AI. Only used for creating example routes from 
# path.jerryio.com files 
#

import os

def parse_route_data(input_file):
    # Get the base filename without the extension
    base_name = os.path.basename(input_file)
    name_only, _ = os.path.splitext(base_name)
    output_file = f"{name_only}.c"

    datapoints = []

    try:
        with open(input_file, 'r') as f:
            for line in f:
                line = line.strip()

                # Stop parsing once we hit the JSON data section
                if line.startswith('#PATH.JERRYIO-DATA'):
                    break

                # Skip empty lines or headers
                if not line or line.startswith('[source') or line.startswith('#'):
                    continue

                # Split by comma and extract x, y
                parts = line.split(',')
                if len(parts) >= 2:
                    try:
                        x = float(parts[0])
                        y = float(parts[1])
                        datapoints.append((x, y))
                    except ValueError:
                        # Skip lines that cannot be parsed into floats
                        pass

    except FileNotFoundError:
        print(f"Error: The file '{input_file}' was not found.")
        return

    # Write the extracted data to a new .c file
    with open(output_file, 'w') as f:
        f.write(f"const static struct {{ float x; float y; }} {name_only}[] = {{\n")

        for x, y in datapoints:
            f.write(f"  {{{x}, {y}}},\n")

        f.write("};\n")

    print(f"Successfully extracted {len(datapoints)} points.")
    print(f"Saved to '{output_file}'.")

if __name__ == "__main__":
    # You can change 'testRoute.txt' to sys.argv[1] to pass the filename via command line
    input_filename = 'testRoute.txt' 
    parse_route_data(input_filename)